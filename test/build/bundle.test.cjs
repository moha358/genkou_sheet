const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

test('bundled extension activates and registers the enable command', () => {
  const commands = new Map();
  const disposable = { dispose() {} };
  const statusBar = { ...disposable, hide() {}, show() {} };
  const vscode = {
    StatusBarAlignment: { Right: 2 },
    TreeItem: class {},
    EventEmitter: class { event() {} fire() {} dispose() {} },
    window: {
      createStatusBarItem: () => statusBar,
      registerCustomEditorProvider: () => disposable,
      registerTreeDataProvider: () => disposable,
      onDidChangeActiveTextEditor: () => disposable,
    },
    workspace: {
      workspaceFolders: undefined,
      onDidSaveTextDocument: () => disposable,
    },
    commands: {
      registerCommand: (id, handler) => { commands.set(id, handler); return disposable; },
      executeCommand: async () => {},
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try {
    const extension = require(path.resolve(__dirname, '../../dist/extension.js'));
    extension.activate({ subscriptions: [] });
    assert.equal(typeof commands.get('genkouSheet.enableFolder'), 'function');
  } finally {
    Module._load = originalLoad;
  }
});
