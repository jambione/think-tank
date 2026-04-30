import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const LUKE_MODEL: vscode.LanguageModelChatSelector = { vendor: 'copilot', family: 'gpt-4.1' };
const HAN_MODEL: vscode.LanguageModelChatSelector  = { vendor: 'copilot', family: 'claude-haiku-4-5' };
const OBI_MODEL: vscode.LanguageModelChatSelector  = { vendor: 'copilot', family: 'gpt-4.1' };

const MAX_QUESTIONS = 5;
const MIN_QUESTIONS = 2;

// ── File helpers ──────────────────────────────────────────────────────────────

function readFile(p: string): string {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function loadPersona(root: string, name: string): string {
    return readFile(path.join(root, 'agents', `${name}.md`));
}

// Loads knowledge files as named sections so agents can cite them by filename.
function loadKnowledge(root: string): string {
    const dir = path.join(root, 'knowledge');
    if (!fs.existsSync(dir)) { return ''; }

    const entries = fs.readdirSync(dir)
        .filter(f => f !== '.gitkeep')
        .map(f => ({ name: f, content: readFile(path.join(dir, f)) }))
        .filter(e => e.content.trim());

    if (!entries.length) { return ''; }

    const names = entries.map(e => e.name).join(', ');
    const sections = entries.map(e => `### ${e.name}\n\n${e.content}`).join('\n\n---\n\n');

    return (
        `\n\n## Shared Knowledge Base\n\n` +
        `When information from these files is relevant, cite the source inline like: *(from ${names})*\n\n` +
        sections
    );
}

// ── Model call ────────────────────────────────────────────────────────────────

async function ask(
    selector: vscode.LanguageModelChatSelector,
    system: string,
    user: string,
    token: vscode.CancellationToken
): Promise<string> {
    const [model] = await vscode.lm.selectChatModels(selector);
    if (!model) { throw new Error(`No model found: ${JSON.stringify(selector)}`); }
    const messages = [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${user}`)];
    const response = await model.sendRequest(messages, {}, token);
    let out = '';
    for await (const chunk of response.text) { out += chunk; }
    return out.trim();
}

// ── History helpers ───────────────────────────────────────────────────────────

type Turn = vscode.ChatRequestTurn | vscode.ChatResponseTurn;

function obiResponses(history: readonly Turn[]): vscode.ChatResponseTurn[] {
    return history.filter(
        (h): h is vscode.ChatResponseTurn =>
            h instanceof vscode.ChatResponseTurn && h.participant === 'think-tank.obi-wan'
    );
}

function obiRequests(history: readonly Turn[]): vscode.ChatRequestTurn[] {
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

function countNumberedItems(text: string): number {
    const matches = text.match(/^\d+\./gm) ?? [];
    return Math.min(Math.max(matches.length, MIN_QUESTIONS), MAX_QUESTIONS);
}

// ── Session persistence ───────────────────────────────────────────────────────

function saveSession(
    workspaceRoot: string,
    topic: string,
    questions: string,
    answers: string[],
    conclusion: string
): string {
    const dir = path.join(workspaceRoot, 'sessions');
    fs.mkdirSync(dir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 50);
    const file = path.join(dir, `${date}-${slug}.md`);

    const qa = answers.map((a, i) => `**A${i + 1}:** ${a}`).join('\n\n');

    fs.writeFileSync(file, [
        `# Think Tank: ${topic}`,
        `*${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}*`,
        '',
        '## Questions',
        '',
        questions,
        '',
        '## Answers',
        '',
        qa,
        '',
        '## Conclusion',
        '',
        conclusion,
        '',
    ].join('\n'), 'utf-8');

    return path.relative(workspaceRoot, file);
}

// ── Session metadata stored in ChatResult so phase survives across turns ──────

interface SessionMeta {
    phase: 'questions' | 'collecting' | 'complete';
    topic: string;
    questionCount: number;
}

function readMeta(turn: vscode.ChatResponseTurn | undefined): Partial<SessionMeta> {
    return (turn?.result?.metadata ?? {}) as Partial<SessionMeta>;
}

// ── Obi-Wan handler ───────────────────────────────────────────────────────────

async function handleObiWan(
    root: string,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const responses = obiResponses(context.history);
    const requests  = obiRequests(context.history);
    const lastMeta  = readMeta(responses.at(-1));

    // Session already concluded — prompt for a new thread
    if (lastMeta.phase === 'complete') {
        stream.markdown('*"If you strike me down..."* — This session is complete. Open a new chat thread to explore another topic.');
        return {};
    }

    const knowledge = loadKnowledge(root);
    const obi  = loadPersona(root, 'obi-wan');
    const luke = loadPersona(root, 'luke') + knowledge;
    const han  = loadPersona(root, 'han')  + knowledge;

    // ── New topic ─────────────────────────────────────────────────────────────
    if (responses.length === 0) {
        const topic = request.prompt.trim();
        if (!topic) {
            stream.markdown('*"Hello there."* — Give me a topic and we shall begin.');
            return {};
        }

        const seed = `Topic under exploration: ${topic}`;

        stream.progress('Luke is consulting the Force...');
        const lukeDraft = await ask(LUKE_MODEL, luke,
            `${seed}\n\nDraft probing questions about this topic. ` +
            `Aim for ${MIN_QUESTIONS}–${MAX_QUESTIONS} questions scaled to the topic's depth.`, token);

        stream.progress('Han is calculating the odds...');
        const hanDraft = await ask(HAN_MODEL, han,
            `${seed}\n\nDraft probing questions about this topic. ` +
            `Aim for ${MIN_QUESTIONS}–${MAX_QUESTIONS} questions scaled to the topic's depth.`, token);

        stream.progress('Luke and Han are comparing notes...');
        const [lukeRefined, hanRefined] = await Promise.all([
            ask(LUKE_MODEL, luke,
                `${seed}\n\nYour draft:\n${lukeDraft}\n\nHan's draft:\n${hanDraft}\n\n` +
                'Review both. Combine the strongest questions into a refined list.', token),
            ask(HAN_MODEL, han,
                `${seed}\n\nYour draft:\n${hanDraft}\n\nLuke's draft:\n${lukeDraft}\n\n` +
                'Review both. Combine the strongest questions into a refined list.', token),
        ]);

        stream.progress('Obi-Wan is synthesizing...');
        const questions = await ask(OBI_MODEL, obi,
            `${seed}\n\nLuke's refined list:\n${lukeRefined}\n\nHan's refined list:\n${hanRefined}\n\n` +
            `Choose the right number of questions for this topic (${MIN_QUESTIONS}–${MAX_QUESTIONS}) ` +
            'based on its complexity and depth. Number them. Nothing else.', token);

        const questionCount = countNumberedItems(questions);

        stream.markdown('*"Hello there."* The council has spoken.\n\n---\n\n');
        stream.markdown(questions);
        stream.markdown(`\n\n---\n\n*${questionCount} question${questionCount !== 1 ? 's' : ''}. Send your answer to question 1.*`);

        return { metadata: { phase: 'questions', topic, questionCount } satisfies SessionMeta };
    }

    // ── Collecting answers ────────────────────────────────────────────────────
    const firstMeta     = readMeta(responses[0]);
    const topic         = firstMeta.topic ?? requests[0]?.prompt ?? '';
    const questionCount = firstMeta.questionCount ?? 3;
    const answersSoFar  = responses.filter(r => readMeta(r).phase === 'collecting').length;
    const answerNumber  = answersSoFar + 1; // this answer's position (1-based)

    if (answerNumber < questionCount) {
        stream.markdown(`*Answer ${answerNumber} received.* — Send your answer to question ${answerNumber + 1}.`);
        return { metadata: { phase: 'collecting', topic, questionCount } satisfies SessionMeta };
    }

    // ── Final answer — conclude and save ──────────────────────────────────────
    const questions     = turnText(responses[0]);
    const priorAnswers  = requests.slice(1).map(t => t.prompt);
    const allAnswers    = [...priorAnswers, request.prompt];
    const qa            = allAnswers.map((a, i) => `Answer ${i + 1}: ${a}`).join('\n\n');

    stream.progress('Obi-Wan is building toward a conclusion...');

    const conclusion = await ask(OBI_MODEL, obi,
        `Topic: ${topic}\n\nQuestions:\n${questions}\n\nAnswers:\n${qa}\n\n` +
        'Synthesize a clear conclusion and actionable recommendations.', token);

    stream.markdown('*"The Force will be with you — always."*\n\n---\n\n');
    stream.markdown(conclusion);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? root;
    const saved = saveSession(workspaceRoot, topic, questions, allAnswers, conclusion);
    stream.markdown(`\n\n---\n\n*Session saved → \`${saved}\`*`);

    return { metadata: { phase: 'complete', topic, questionCount } satisfies SessionMeta };
}

// ── Luke handler ──────────────────────────────────────────────────────────────

async function handleLuke(
    root: string,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const system = loadPersona(root, 'luke') + loadKnowledge(root);
    const [model] = await vscode.lm.selectChatModels(LUKE_MODEL);
    if (!model) {
        stream.markdown('"I have a bad feeling about this." — GPT-4.1 not found. Check your Copilot model access.');
        return {};
    }
    const resp = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${request.prompt}`)],
        {}, token
    );
    for await (const chunk of resp.text) { stream.markdown(chunk); }
    return {};
}

// ── Han handler ───────────────────────────────────────────────────────────────

async function handleHan(
    root: string,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<vscode.ChatResult> {
    const system = loadPersona(root, 'han') + loadKnowledge(root);
    const [model] = await vscode.lm.selectChatModels(HAN_MODEL);
    if (!model) {
        stream.markdown('"Never tell me the odds." — Claude Haiku 4.5 not found. Check your Copilot model access.');
        return {};
    }
    const resp = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(`${system}\n\n---\n\n${request.prompt}`)],
        {}, token
    );
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
