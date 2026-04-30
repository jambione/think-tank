import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Model selectors — family names must match what GitHub Copilot exposes via vscode.lm
const LUKE_MODEL: vscode.LanguageModelChatSelector = { vendor: 'copilot', family: 'gpt-4.1' };
const HAN_MODEL: vscode.LanguageModelChatSelector  = { vendor: 'copilot', family: 'claude-haiku-4-5' };
const OBI_MODEL: vscode.LanguageModelChatSelector  = { vendor: 'copilot', family: 'gpt-4.1' };

// ── File helpers ─────────────────────────────────────────────────────────────

function readFile(p: string): string {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function loadPersona(root: string, name: string): string {
    return readFile(path.join(root, 'agents', `${name}.md`));
}

function loadKnowledge(root: string): string {
    const dir = path.join(root, 'knowledge');
    if (!fs.existsSync(dir)) { return ''; }
    const files = fs.readdirSync(dir)
        .filter(f => f !== '.gitkeep')
        .map(f => path.join(dir, f))
        .filter(f => fs.statSync(f).isFile());
    return files.map(f => readFile(f)).filter(Boolean).join('\n\n---\n\n');
}

// ── Model call ────────────────────────────────────────────────────────────────

async function ask(
    selector: vscode.LanguageModelChatSelector,
    system: string,
    user: string,
    token: vscode.CancellationToken
): Promise<string> {
    const [model] = await vscode.lm.selectChatModels(selector);
    if (!model) {
        throw new Error(`No model found for selector: ${JSON.stringify(selector)}`);
    }
    const messages = [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${user}`)];
    const response = await model.sendRequest(messages, {}, token);
    let out = '';
    for await (const chunk of response.text) { out += chunk; }
    return out.trim();
}

// ── History helpers ──────────────────────────────────────────────────────────

function obiResponses(history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]): vscode.ChatResponseTurn[] {
    return history.filter(
        (h): h is vscode.ChatResponseTurn =>
            h instanceof vscode.ChatResponseTurn && h.participant === 'think-tank.obi-wan'
    );
}

function obiRequests(history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]): vscode.ChatRequestTurn[] {
    return history.filter(
        (h): h is vscode.ChatRequestTurn =>
            h instanceof vscode.ChatRequestTurn && h.participant === 'think-tank.obi-wan'
    );
}

function turnText(turn: vscode.ChatResponseTurn): string {
    return turn.response
        .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
        .map(p => p.value.value)
        .join('');
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleObiWan(
    root: string,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const responses = obiResponses(context.history);
    const requests  = obiRequests(context.history);
    const phase     = responses.length; // 0 = new topic | 1–2 = collecting answers | 3 = conclude

    const knowledge = loadKnowledge(root);
    const kb  = knowledge ? `\n\n## Shared Knowledge Base\n\n${knowledge}` : '';
    const obi  = loadPersona(root, 'obi-wan');
    const luke = loadPersona(root, 'luke') + kb;
    const han  = loadPersona(root, 'han')  + kb;

    // ── Phase 0: new topic → orchestrate Luke & Han → present 3 questions ──
    if (phase === 0) {
        const topic = request.prompt.trim();
        if (!topic) {
            stream.markdown('*"Hello there."* — Give me a topic and we shall begin.');
            return {};
        }

        const seed = `Topic under exploration: ${topic}`;

        stream.progress('Luke is consulting the Force...');
        const lukeDraft = await ask(LUKE_MODEL, luke,
            `${seed}\n\nDraft 3 sharp, probing questions about this topic.`, token);

        stream.progress('Han is calculating the odds...');
        const hanDraft = await ask(HAN_MODEL, han,
            `${seed}\n\nDraft 3 sharp, probing questions about this topic.`, token);

        stream.progress('Luke and Han are comparing notes...');
        const [lukeRefined, hanRefined] = await Promise.all([
            ask(LUKE_MODEL, luke,
                `${seed}\n\nYour draft:\n${lukeDraft}\n\nHan's draft:\n${hanDraft}\n\n` +
                'Review both. Propose a refined list of 3–5 questions combining the best of both.', token),
            ask(HAN_MODEL, han,
                `${seed}\n\nYour draft:\n${hanDraft}\n\nLuke's draft:\n${lukeDraft}\n\n` +
                'Review both. Propose a refined list of 3–5 questions combining the best of both.', token),
        ]);

        stream.progress('Obi-Wan is synthesizing...');
        const questions = await ask(OBI_MODEL, obi,
            `${seed}\n\nLuke's refined list:\n${lukeRefined}\n\nHan's refined list:\n${hanRefined}\n\n` +
            'Synthesize into exactly 3 powerful questions. Number them. Nothing else.', token);

        stream.markdown('*"Hello there."* The council has spoken.\n\n---\n\n');
        stream.markdown(questions);
        stream.markdown('\n\n---\n\n*Answer question 1 to begin. Send each answer as a follow-up message.*');
        return {};
    }

    // ── Phase 1–2: acknowledge answer, prompt for next ──
    if (phase <= 2) {
        stream.markdown(`*Answer ${phase} received, young Padawan.* — Send your answer to question ${phase + 1}.`);
        return {};
    }

    // ── Phase 3: all answers in → conclude ──
    const topic     = requests[0]?.prompt ?? '';
    const questions = turnText(responses[0]);
    const answers   = [...requests.slice(1).map(t => t.prompt), request.prompt];
    const qa        = answers.map((a, i) => `Answer ${i + 1}: ${a}`).join('\n\n');

    stream.progress('Obi-Wan is building toward a conclusion...');

    const conclusion = await ask(OBI_MODEL, obi,
        `Topic: ${topic}\n\nQuestions:\n${questions}\n\nAnswers:\n${qa}\n\n` +
        'Synthesize a clear conclusion and actionable recommendations.', token);

    stream.markdown('*"The Force will be with you — always."*\n\n---\n\n');
    stream.markdown(conclusion);
    return {};
}

async function handleLuke(
    root: string,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const knowledge = loadKnowledge(root);
    const kb = knowledge ? `\n\n## Shared Knowledge Base\n\n${knowledge}` : '';
    const system = loadPersona(root, 'luke') + kb;

    const [model] = await vscode.lm.selectChatModels(LUKE_MODEL);
    if (!model) {
        stream.markdown('"I have a bad feeling about this." — GPT-4.1 not found. Check your Copilot model access.');
        return {};
    }

    const msgs = [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${request.prompt}`)];
    const resp = await model.sendRequest(msgs, {}, token);
    for await (const chunk of resp.text) { stream.markdown(chunk); }
    return {};
}

async function handleHan(
    root: string,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const knowledge = loadKnowledge(root);
    const kb = knowledge ? `\n\n## Shared Knowledge Base\n\n${knowledge}` : '';
    const system = loadPersona(root, 'han') + kb;

    const [model] = await vscode.lm.selectChatModels(HAN_MODEL);
    if (!model) {
        stream.markdown('"Never tell me the odds." — Claude Haiku 4.5 not found. Check your Copilot model access.');
        return {};
    }

    const msgs = [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${request.prompt}`)];
    const resp = await model.sendRequest(msgs, {}, token);
    for await (const chunk of resp.text) { stream.markdown(chunk); }
    return {};
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    const root = context.extensionPath;

    const obi = vscode.chat.createChatParticipant('think-tank.obi-wan',
        (req, ctx, stream, token) => handleObiWan(root, req, ctx, stream, token));
    obi.iconPath = new vscode.ThemeIcon('lightbulb');

    const luke = vscode.chat.createChatParticipant('think-tank.luke',
        (req, ctx, stream, token) => handleLuke(root, req, ctx, stream, token));
    luke.iconPath = new vscode.ThemeIcon('star');

    const han = vscode.chat.createChatParticipant('think-tank.han',
        (req, ctx, stream, token) => handleHan(root, req, ctx, stream, token));
    han.iconPath = new vscode.ThemeIcon('rocket');

    context.subscriptions.push(obi, luke, han);
}

export function deactivate(): void {}
