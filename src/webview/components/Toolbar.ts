/**
 * Editor Toolbar Component (上部ツールバーコンポーネント)
 * 書字方向・罫線カラー・マス目サイズ・ルビ/傍点挿入・組版出力の操作と文字数集計を表示する。
 */

import { ManuscriptStats } from '../../core/counter';
import { GenkouConfig, GridColorTheme, WritingMode } from '../../core/theme';

export interface ToolbarCallbacks {
  onConfigChange: (partial: Partial<GenkouConfig>) => void;
  onOpenRubyModal: () => void;
  onInsertBouten: () => void;
  onRequestExport: (format: 'html' | 'combined') => void;
}

export class EditorToolbar {
  private readonly root: HTMLElement;
  private statsEl!: HTMLElement;
  private modeSelect!: HTMLSelectElement;
  private colorSelect!: HTMLSelectElement;
  private sizeSelect!: HTMLSelectElement;

  constructor(
    container: HTMLElement,
    private readonly callbacks: ToolbarCallbacks
  ) {
    this.root = document.createElement('header');
    this.root.className = 'genkou-toolbar';
    this.buildDom();
    container.appendChild(this.root);
  }

  private buildDom(): void {
    const left = document.createElement('div');
    left.className = 'genkou-toolbar-left';

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'genkou-stats-badge';
    this.statsEl.textContent = '0字 | 400字×0枚';
    left.appendChild(this.statsEl);

    // 書字方向切替
    const modeGroup = document.createElement('label');
    modeGroup.className = 'genkou-control-group';
    modeGroup.textContent = '方向:';
    this.modeSelect = document.createElement('select');
    this.modeSelect.className = 'genkou-select';
    this.modeSelect.innerHTML = `
      <option value="vertical-rl">縦書き</option>
      <option value="horizontal-tb">横書き</option>
    `;
    this.modeSelect.addEventListener('change', () => {
      this.callbacks.onConfigChange({
        writingMode: this.modeSelect.value as WritingMode,
      });
    });
    modeGroup.appendChild(this.modeSelect);
    left.appendChild(modeGroup);

    // 罫線カラー切替
    const colorGroup = document.createElement('label');
    colorGroup.className = 'genkou-control-group';
    colorGroup.textContent = '罫線:';
    this.colorSelect = document.createElement('select');
    this.colorSelect.className = 'genkou-select';
    this.colorSelect.innerHTML = `
      <option value="green">緑（コクヨ風）</option>
      <option value="red">赤（丸善・文豪風）</option>
      <option value="dark">ダーク</option>
    `;
    this.colorSelect.addEventListener('change', () => {
      this.callbacks.onConfigChange({
        gridColor: this.colorSelect.value as GridColorTheme,
      });
    });
    colorGroup.appendChild(this.colorSelect);
    left.appendChild(colorGroup);

    // マス目サイズ切替
    const sizeGroup = document.createElement('label');
    sizeGroup.className = 'genkou-control-group';
    sizeGroup.textContent = '用紙:';
    this.sizeSelect = document.createElement('select');
    this.sizeSelect.className = 'genkou-select';
    this.sizeSelect.innerHTML = `
      <option value="20x20">20字×20行 (400字詰)</option>
      <option value="20x10">20字×10行 (200字詰)</option>
      <option value="40x30">40字×30行 (1200字詰)</option>
    `;
    this.sizeSelect.addEventListener('change', () => {
      const [c, l] = this.sizeSelect.value.split('x').map(Number);
      if (c && l) {
        this.callbacks.onConfigChange({ charsPerLine: c, linesPerPage: l });
      }
    });
    sizeGroup.appendChild(this.sizeSelect);
    left.appendChild(sizeGroup);

    // 右側アクションボタン群
    const right = document.createElement('div');
    right.className = 'genkou-toolbar-right';

    const rubyBtn = document.createElement('button');
    rubyBtn.type = 'button';
    rubyBtn.className = 'genkou-btn';
    rubyBtn.textContent = 'ルビ (⌘R)';
    rubyBtn.title = '現在位置または選択文字にルビを挿入・編集';
    rubyBtn.addEventListener('click', () => this.callbacks.onOpenRubyModal());
    right.appendChild(rubyBtn);

    const boutenBtn = document.createElement('button');
    boutenBtn.type = 'button';
    boutenBtn.className = 'genkou-btn';
    boutenBtn.textContent = '傍点';
    boutenBtn.title = '現在位置に傍点記法《《…》》を挿入';
    boutenBtn.addEventListener('click', () => this.callbacks.onInsertBouten());
    right.appendChild(boutenBtn);

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'genkou-btn genkou-btn-primary';
    exportBtn.textContent = '組版・PDF出力';
    exportBtn.title = '印刷・PDF保存用の原稿用紙HTMLを出力';
    exportBtn.addEventListener('click', () =>
      this.callbacks.onRequestExport('html')
    );
    right.appendChild(exportBtn);

    this.root.appendChild(left);
    this.root.appendChild(right);
  }

  public updateStats(stats: ManuscriptStats): void {
    this.statsEl.textContent = `実文字: ${stats.effectiveChars.toLocaleString()}字 (空白込 ${stats.charsWithSpaces.toLocaleString()}字) | 400字詰: ${stats.sheets400}枚 | 実組版: ${stats.layoutPages}枚 (${stats.layoutLines}行)`;
  }

  public syncConfig(config: GenkouConfig): void {
    this.modeSelect.value = config.writingMode;
    this.colorSelect.value = config.gridColor;
    const sizeKey = `${config.charsPerLine}x${config.linesPerPage}`;
    if (
      Array.from(this.sizeSelect.options).some((opt) => opt.value === sizeKey)
    ) {
      this.sizeSelect.value = sizeKey;
    } else {
      const customOpt = document.createElement('option');
      customOpt.value = sizeKey;
      customOpt.textContent = `${config.charsPerLine}字×${config.linesPerPage}行`;
      this.sizeSelect.appendChild(customOpt);
      this.sizeSelect.value = sizeKey;
    }
  }
}
