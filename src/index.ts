import {
  commands,
  DocumentSelector,
  ExtensionContext,
  extensions,
  LanguageClient,
  LanguageClientOptions,
  languages,
  NodeModule,
  services,
  TextEdit,
  TransportKind,
  window,
  workspace,
  WorkspaceEdit,
} from 'coc.nvim';
import { existsSync } from 'fs';
import { lt } from 'semver';
import { PythonCodeActionProvider } from './codeActionsProvider';
import { PythonFormattingEditProvider } from './formatProvider';
import { LinterProvider } from './linterProvider';

const documentSelector: DocumentSelector = [{ scheme: 'file', language: 'python' }];

export async function activate(context: ExtensionContext): Promise<void> {
  const state = extensions.getExtensionState('coc-python');
  if (state.toString() === 'activated') {
    window.showMessage(`coc-python is installed and activated, coc-pyright will be disabled`, 'warning');
    return;
  }
  if (lt(process.versions.node, '12.0.0')) {
    window.showMessage(`Pyright needs Node.js v12+ to work, your Node.js is ${process.version}.`, 'error');
    return;
  }
  const module = context.asAbsolutePath('node_modules/pyright/langserver.index.js');
  if (!existsSync(module)) {
    window.showMessage(`Pyright file doesn't exist, please reinstall coc-pyright`, 'error');
    return;
  }

  const serverOptions: NodeModule = {
    module,
    transport: TransportKind.ipc,
  };

  const outputChannel = window.createOutputChannel('Pyright');
  const config = workspace.getConfiguration('pyright');
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {
      configurationSection: ['python', 'pyright'],
    },
    outputChannel,
    disableCompletion: !!config.get('disableCompletion'),
    progressOnInitialization: true,
  };

  const client: LanguageClient = new LanguageClient('pyright', 'Pyright Server', serverOptions, clientOptions);
  context.subscriptions.push(services.registLanguageClient(client));

  const formatProvider = new PythonFormattingEditProvider();
  context.subscriptions.push(languages.registerDocumentFormatProvider(documentSelector, formatProvider));
  context.subscriptions.push(languages.registerDocumentRangeFormatProvider(documentSelector, formatProvider));

  context.subscriptions.push(new LinterProvider(context));

  const codeActionProvider = new PythonCodeActionProvider();
  context.subscriptions.push(languages.registerCodeActionProvider(documentSelector, codeActionProvider, 'Pyright'));

  const textEditorCommands = ['pyright.organizeimports', 'pyright.addoptionalforparam', 'pyright.restartserver'];
  textEditorCommands.forEach((commandName: string) => {
    context.subscriptions.push(
      commands.registerCommand(commandName, async (offset: number) => {
        const doc = await workspace.document;
        const cmd = {
          command: commandName,
          arguments: [doc.uri.toString(), offset],
        };

        const edits = await client.sendRequest<TextEdit[] | undefined>('workspace/executeCommand', cmd);
        if (!edits) {
          return;
        }

        const wsEdit: WorkspaceEdit = {
          changes: {
            [doc.uri]: edits,
          },
        };
        await workspace.applyEdit(wsEdit);
      })
    );
  });

  const genericCommands = ['pyright.createtypestub'];
  genericCommands.forEach((command: string) => {
    context.subscriptions.push(
      commands.registerCommand(command, async (...args: any[]) => {
        const root = workspace.root;
        const module = args.pop();
        if (!module) {
          window.showMessage(`Module name is missing`, 'warning');
          return;
        }

        const cmd = {
          command,
          arguments: [root, module],
        };
        client.sendRequest('workspace/executeCommand', cmd);
      })
    );
  });
}
