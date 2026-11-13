/**
 * Compare Webview Entrypoint (バックアップ比較画面: 原稿用紙2枚の並列表示)
 * 左右の原稿用紙を連動してスクロールし、変更のある段落を強調表示する。各ペインの「こちらを採用」で Host に結果を返す。
 */

import { countManuscript } from '../core/counter';
import { layoutDocument } from '../core/layoutEngine';
import { diffParagraphs } from '../core/paragraphDiff';
import {
  buildCssVariables,
  CompareHostToWebviewMessage,
  ComparePaneData,
  CompareWebviewToHostMessage,
  GenkouConfig,
} from '../core/theme';
import { GenkouSheetRenderer } from './components/GenkouPage';

declare function acquireVsCodeApi(): {
  postMessage(msg: CompareWebviewToHostMessage): void;
};

const vscode = acquireVsCodeApi();
const noop = () => undefined;

function createPane(
  container: HTMLElement,
  side: 'left' | 'right',
  data: ComparePaneData,
  changedCount: number,
  config: GenkouConfig
): { renderer: GenkouSheetRenderer; button: HTMLButtonElement } {
  const pane = document.createElement('section');
  pane.className = `genkou-compare-pane is-${side}`;

  const header = document.createElement('header');
  header.className = 'genkou-compare-pane-header';

  const titleBox = document.createElement('div');
  titleBox.className = 'genkou-compare-pane-title';
  const label = document.createElement('strong');
  label.textContent = data.label;
  const detail = document.createElement('span');
  detail.className = 'genkou-compare-pane-detail';
  const stats = countManuscript(data.text, config.charsPerLine, config.linesPerPage);
  detail.textContent = `${data.detail}　${stats.effectiveChars.toLocaleString()}字・変更のある段落 ${changedCount}`;
  titleBox.append(label, detail);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'genkou-btn genkou-btn-primary';
  button.textContent = data.adoptLabel;
  button.addEventListener('click', () => vscode.postMessage({ type: 'ADOPT', side }));

  header.append(titleBox, button);
  pane.appendChild(header);
  container.appendChild(pane);

  const renderer = new GenkouSheetRenderer(pane, {
    onCellClick: noop,
    onCellDragSelect: noop,
    onCellDoubleClick: noop,
  });
  return { renderer, button };
}

/**
 * 一方のスクロール位置をもう一方に反映する。
 * 反映によって相手側でも scroll イベントが起きるため、次の描画フレームまで相手側のイベントを無視する
 * （ページ数が違い相手側でスクロール位置が丸められても、元のペインへ跳ね返らないようにする）。
 */
function linkScroll(a: HTMLElement, b: HTMLElement): void {
  let follower: HTMLElement | null = null;
  const follow = (from: HTMLElement, to: HTMLElement) => () => {
    if (follower === from) return;
    follower = to;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (follower === to) follower = null;
    }));
  };
  a.addEventListener('scroll', follow(a, b));
  b.addEventListener('scroll', follow(b, a));
}

function render(root: HTMLElement, msg: CompareHostToWebviewMessage): void {
  document.documentElement.style.cssText = buildCssVariables(msg.config);
  root.replaceChildren();

  const diff = diffParagraphs(msg.left.text, msg.right.text);
  const layouts = {
    left: layoutDocument(msg.left.text, msg.config.charsPerLine, msg.config.linesPerPage),
    right: layoutDocument(msg.right.text, msg.config.charsPerLine, msg.config.linesPerPage),
  };

  const body = document.createElement('div');
  body.className = 'genkou-compare-body';
  root.appendChild(body);

  // VS Code の差分表示と同じく、左にバックアップ（旧）、右に現在の原稿（新）を置く
  const left = createPane(body, 'left', msg.left, diff.left.size, msg.config);
  const right = createPane(body, 'right', msg.right, diff.right.size, msg.config);

  const origin = { globalLineIndex: 0, cellIndex: 0 };
  left.renderer.render(layouts.left, msg.config, origin, null, msg.fileName, { readOnly: true, changedParagraphs: diff.left });
  right.renderer.render(layouts.right, msg.config, origin, null, msg.fileName, { readOnly: true, changedParagraphs: diff.right });

  linkScroll(left.renderer.getViewportElement(), right.renderer.getViewportElement());

  // 縦書きは右端が書き出しなので、最初に右端を表示する（連動で右ペインも追従する）
  if (msg.config.writingMode === 'vertical-rl') {
    const viewport = left.renderer.getViewportElement();
    viewport.scrollLeft = viewport.scrollWidth;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('genkou-root');
  if (!root) return;
  window.addEventListener('message', (event: MessageEvent<CompareHostToWebviewMessage>) => {
    if (event.data.type === 'INIT_COMPARE') render(root, event.data);
  });
  vscode.postMessage({ type: 'COMPARE_READY' });
});
