/**
 * Ruby & Bouten Editor Modal Component (ルビ・傍点挿入/編集ポップオーバー)
 */

export interface RubyModalResult {
  baseText: string;
  rubyText: string;
  replaceRange?: { start: number; end: number };
}

export class RubyModal {
  private readonly backdrop: HTMLElement;
  private baseInput!: HTMLInputElement;
  private rubyInput!: HTMLInputElement;
  private currentReplaceRange?: { start: number; end: number };
  private onCloseCallback?: () => void;

  constructor(
    container: HTMLElement,
    private readonly onSubmit: (result: RubyModalResult) => void
  ) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'genkou-modal-backdrop is-hidden';
    this.buildDom();
    container.appendChild(this.backdrop);
  }

  private buildDom(): void {
    const modal = document.createElement('div');
    modal.className = 'genkou-modal';

    const title = document.createElement('h3');
    title.className = 'genkou-modal-title';
    title.textContent = 'ルビの挿入・編集 (青空文庫形式)';
    modal.appendChild(title);

    const baseField = document.createElement('label');
    baseField.className = 'genkou-form-field';
    baseField.textContent = '親文字 (本文):';
    this.baseInput = document.createElement('input');
    this.baseInput.type = 'text';
    this.baseInput.className = 'genkou-form-input';
    this.baseInput.placeholder = '例: 原稿用紙';
    baseField.appendChild(this.baseInput);
    modal.appendChild(baseField);

    const rubyField = document.createElement('label');
    rubyField.className = 'genkou-form-field';
    rubyField.textContent = 'ルビ (ふりがな - 空欄でルビ解除):';
    this.rubyInput = document.createElement('input');
    this.rubyInput.type = 'text';
    this.rubyInput.className = 'genkou-form-input';
    this.rubyInput.placeholder = '例: げんこうようし';
    rubyField.appendChild(this.rubyInput);
    modal.appendChild(rubyField);

    const actions = document.createElement('div');
    actions.className = 'genkou-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'genkou-btn';
    cancelBtn.textContent = 'キャンセル (Esc)';
    cancelBtn.addEventListener('click', () => this.close());

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'genkou-btn genkou-btn-primary';
    applyBtn.textContent = '適用 (Enter)';
    applyBtn.addEventListener('click', () => this.submit());

    actions.append(cancelBtn, applyBtn);
    modal.appendChild(actions);

    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.submit();
      }
    });

    this.backdrop.addEventListener('mousedown', (e) => {
      if (e.target === this.backdrop) {
        this.close();
      }
    });

    this.backdrop.appendChild(modal);
  }

  public open(
    initialBase: string,
    initialRuby: string,
    replaceRange?: { start: number; end: number },
    onClose?: () => void
  ): void {
    this.baseInput.value = initialBase;
    this.rubyInput.value = initialRuby;
    this.currentReplaceRange = replaceRange;
    this.onCloseCallback = onClose;
    this.backdrop.classList.remove('is-hidden');

    setTimeout(() => {
      if (initialBase) {
        this.rubyInput.focus();
        this.rubyInput.select();
      } else {
        this.baseInput.focus();
      }
    }, 10);
  }

  public close(): void {
    this.backdrop.classList.add('is-hidden');
    this.onCloseCallback?.();
  }

  private submit(): void {
    const baseText = this.baseInput.value.trim();
    const rubyText = this.rubyInput.value.trim();
    if (!baseText) {
      this.close();
      return;
    }
    this.onSubmit({
      baseText,
      rubyText,
      replaceRange: this.currentReplaceRange,
    });
    this.close();
  }
}
