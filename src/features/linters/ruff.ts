import { spawn } from 'child_process';
import { DiagnosticTag, OutputChannel, Range, TextDocument, TextEdit, Uri, workspace, WorkspaceEdit } from 'coc.nvim';
import { ILinterInfo, ILintMessage, LintMessageSeverity } from '../../types';
import { BaseLinter } from './baseLinter';

const COLUMN_OFF_SET = 1;

interface IRuffLocation {
  row: number;
  column: number;
}

interface IRuffFix {
  content: string;
  location: IRuffLocation;
  end_location: IRuffLocation;
}

// {
//   "code": "F401",
//   "message": "`numpy` imported but unused",
//   "fix": {
//     "content": "",
//     "location": {
//       "row": 3,
//       "column": 0
//     },
//     "end_location": {
//       "row": 4,
//       "column": 0
//     }
//   },
//   "location": {
//     "row": 3,
//     "column": 8
//   },
//   "end_location": {
//     "row": 3,
//     "column": 19
//   },
//   "filename": "/path/to/bug.py"
// },

interface IRuffLintMessage {
  kind: string | { [key: string]: any[] };
  code: string;
  message: string;
  fix: IRuffFix;
  location: IRuffLocation;
  end_location: IRuffLocation;
  filename: string;
}

export class Ruff extends BaseLinter {
  constructor(info: ILinterInfo, outputChannel: OutputChannel) {
    super(info, outputChannel, COLUMN_OFF_SET);
  }

  private fixToWorkspaceEdit(filename: string, fix: IRuffFix): WorkspaceEdit | null {
    if (!fix) return null;

    const u = Uri.parse(filename).toString();
    const range = Range.create(fix.location.row - 1, fix.location.column, fix.end_location.row - 1, fix.end_location.column);
    return {
      changes: {
        [u]: [TextEdit.replace(range, fix.content)],
      },
    };
  }

  private runRuff(document: TextDocument): Promise<string> {
    const fsPath = Uri.parse(document.uri).fsPath;
    const args = [...this.info.linterArgs(), '--format', 'json', '--exit-zero', '--stdin-filename', fsPath, '-'];
    const command = this.info.pathName();

    this.outputChannel.appendLine(`${'#'.repeat(10)} Run linter ${this.info.id}:`);
    this.outputChannel.appendLine(`${command} ${args.join(' ')}`);
    this.outputChannel.appendLine('');

    const child = spawn(command, args, { cwd: workspace.root });
    return new Promise((resolve) => {
      child.stdin.setDefaultEncoding('utf8');
      child.stdin.write(document.getText());
      child.stdin.end();

      let result = '';
      child.stdout.on('data', data => {
        result += data.toString('utf-8').trim();
      });
      child.on('close', () => {
        resolve(result);
      });
    });
  }

  protected async runLinter(document: TextDocument): Promise<ILintMessage[]> {
    if (!this.info.isEnabled(Uri.parse(document.uri))) return [];

    try {
      const result = await this.runRuff(document);

      this.outputChannel.append(`${'#'.repeat(10)} Linting Output - ${this.info.id}${'#'.repeat(10)}\n`);
      this.outputChannel.append(result);
      this.outputChannel.appendLine('');

      const messages: ILintMessage[] = JSON.parse(result).map((msg: IRuffLintMessage) => {
        return {
          line: msg.location.row,
          column: msg.location.column - COLUMN_OFF_SET,
          endLine: msg.end_location.row,
          endColumn: msg.end_location.column,
          code: msg.code,
          message: msg.message,
          type: '',
          severity: LintMessageSeverity.Warning, // https://github.com/charliermarsh/ruff/issues/645
          tags: ['F401', 'F841'].includes(msg.code) ? [DiagnosticTag.Unnecessary] : [],
          provider: this.info.id,
          file: msg.filename,
          fix: this.fixToWorkspaceEdit(msg.filename, msg.fix),
        } as ILintMessage;
      });

      return messages;
    } catch (error) {
      this.outputChannel.appendLine(`Linting with ${this.info.id} failed:`);
      if (error instanceof Error) {
        this.outputChannel.appendLine(error.message.toString());
      }
      return [];
    }
  }
}
