declare module "vscode" {
  export type Disposable = { dispose(): void };

  export class Uri {
    fsPath: string;
    static file(path: string): Uri;
    static joinPath(base: Uri, ...paths: string[]): Uri;
  }

  export class ThemeIcon {
    constructor(id: string);
  }

  export class MarkdownString {
    value: string;
    constructor(value?: string);
    appendMarkdown(value: string): MarkdownString;
  }

  export class Position {
    line: number;
    character: number;
    constructor(line: number, character: number);
  }

  export class Range {
    start: Position;
    end: Position;
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  }

  export class EventEmitter<T> {
    event: Event<T>;
    fire(data: T): void;
    dispose(): void;
  }

  export type Event<T> = (listener: (event: T) => unknown) => Disposable;

  export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
  }

  export class TreeItem {
    label?: string;
    collapsibleState?: TreeItemCollapsibleState;
    description?: string | boolean;
    tooltip?: string;
    contextValue?: string;
    iconPath?: ThemeIcon;
    command?: {
      command: string;
      title: string;
      arguments?: unknown[];
    };
    constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
  }

  export class Hover {
    contents: MarkdownString | MarkdownString[] | string | string[];
    range?: Range;
    constructor(contents: MarkdownString | MarkdownString[] | string | string[], range?: Range);
  }

  export class CodeLens {
    range: Range;
    command?: Command;
    constructor(range: Range, command?: Command);
  }

  export type Command = {
    command: string;
    title: string;
    arguments?: unknown[];
  };

  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3
  }

  export class Diagnostic {
    range: Range;
    message: string;
    severity: DiagnosticSeverity;
    source?: string;
    constructor(range: Range, message: string, severity?: DiagnosticSeverity);
  }

  export interface DiagnosticCollection extends Disposable {
    clear(): void;
    set(uri: Uri, diagnostics: Diagnostic[]): void;
  }

  export interface TreeDataProvider<T> {
    onDidChangeTreeData?: Event<T | undefined | null | void>;
    getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
    getChildren(element?: T): ProviderResult<T[]>;
  }

  export type TextLine = {
    text: string;
  };

  export type TextDocument = {
    uri: Uri;
    fileName: string;
    lineCount: number;
    lineAt(line: number): TextLine;
  };

  export interface HoverProvider {
    provideHover(document: TextDocument, position: Position): ProviderResult<Hover>;
  }

  export interface CodeLensProvider {
    provideCodeLenses(document: TextDocument): ProviderResult<CodeLens[]>;
  }

  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

  export namespace window {
    function createTreeView<T>(viewId: string, options: { treeDataProvider: TreeDataProvider<T> }): Disposable;
    function showErrorMessage(message: string): Thenable<string | undefined>;
  }

  export namespace workspace {
    const workspaceFolders: Array<{ uri: Uri; name: string }> | undefined;
    function getConfiguration(section?: string): {
      get<T>(key: string, defaultValue: T): T;
    };
    function openTextDocument(uri: Uri): Thenable<unknown>;
    function openTextDocument(options: { content: string; language?: string }): Thenable<unknown>;
  }

  export namespace window {
    function showTextDocument(document: unknown): Thenable<unknown>;
    function showInformationMessage(message: string): Thenable<string | undefined>;
  }

  export namespace commands {
    function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
  }

  export namespace languages {
    function createDiagnosticCollection(name: string): DiagnosticCollection;
    function registerHoverProvider(selector: unknown, provider: HoverProvider): Disposable;
    function registerCodeLensProvider(selector: unknown, provider: CodeLensProvider): Disposable;
  }

  export type ExtensionContext = {
    subscriptions: Disposable[];
  };
}
