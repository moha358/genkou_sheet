/**
 * Global Theme Management & Configuration Types
 * すべての色・フォント・余白・サイズ・角丸・影をこのファイルと globalTheme.css で一元管理する。
 */

export type WritingMode = 'vertical-rl' | 'horizontal-tb';
export type GridColorTheme = 'green' | 'red' | 'dark';

export interface GenkouConfig {
  enabled: boolean;
  writingMode: WritingMode;
  gridColor: GridColorTheme;
  charsPerLine: number;
  linesPerPage: number;
  autoIndent: boolean;
  highlightDialogue: boolean;
}

export const DEFAULT_GENKOU_CONFIG: GenkouConfig = {
  enabled: false,
  writingMode: 'vertical-rl',
  gridColor: 'green',
  charsPerLine: 20,
  linesPerPage: 20,
  autoIndent: true,
  highlightDialogue: true,
};

export interface ColorPaletteTokens {
  paperBg: string;
  canvasBg: string;
  gridPrimary: string;
  gridSub: string;
  textMain: string;
  textDialogue: string;
  textRuby: string;
  textMuted: string;
  cursorBg: string;
  cursorBorder: string;
  activeCellBg: string;
  toolbarBg: string;
  toolbarBorder: string;
  accentColor: string;
}

export interface TypographyTokens {
  fontFamily: string;
  uiFontFamily: string;
  cellFontSize: string;
  rubyFontSize: string;
  hangingFontSize: string;
  toolbarFontSize: string;
  fontWeightNormal: string;
  fontWeightBold: string;
}

export interface SpacingAndGridTokens {
  cellSize: string;
  rubyGap: string;
  hashiraWidth: string;
  pagePadding: string;
  pageGap: string;
  toolbarHeight: string;
  spacingXs: string;
  spacingSm: string;
  spacingMd: string;
  spacingLg: string;
}

export interface ShapeAndShadowTokens {
  borderRadiusSm: string;
  borderRadiusMd: string;
  pageShadow: string;
  modalShadow: string;
  outerBorderWidth: string;
  innerBorderWidth: string;
}

export const COLOR_PALETTES: Record<GridColorTheme, ColorPaletteTokens> = {
  green: {
    paperBg: '#fdfcf7',
    canvasBg: '#ebe8df',
    gridPrimary: '#3b8c66',
    gridSub: '#8ec5ab',
    textMain: '#1f2421',
    textDialogue: '#0d4f8b',
    textRuby: '#2c5e46',
    textMuted: '#688274',
    cursorBg: 'rgba(59, 140, 102, 0.18)',
    cursorBorder: '#246b49',
    activeCellBg: 'rgba(59, 140, 102, 0.08)',
    toolbarBg: '#f6f4ec',
    toolbarBorder: '#d5d0c3',
    accentColor: '#2d7a56',
  },
  red: {
    paperBg: '#fcf9f2',
    canvasBg: '#e9e2d5',
    gridPrimary: '#b84a39',
    gridSub: '#dfa096',
    textMain: '#231c18',
    textDialogue: '#7c2d12',
    textRuby: '#8c3527',
    textMuted: '#8a6862',
    cursorBg: 'rgba(184, 74, 57, 0.18)',
    cursorBorder: '#963324',
    activeCellBg: 'rgba(184, 74, 57, 0.08)',
    toolbarBg: '#f5efe4',
    toolbarBorder: '#d8cbb8',
    accentColor: '#a63c2c',
  },
  dark: {
    paperBg: '#1b2021',
    canvasBg: '#121516',
    gridPrimary: '#3e7862',
    gridSub: '#294c3f',
    textMain: '#e3e8e6',
    textDialogue: '#7cc0ff',
    textRuby: '#9dc8b5',
    textMuted: '#6e8c7f',
    cursorBg: 'rgba(82, 168, 134, 0.28)',
    cursorBorder: '#63c79e',
    activeCellBg: 'rgba(82, 168, 134, 0.12)',
    toolbarBg: '#161a1b',
    toolbarBorder: '#2b3537',
    accentColor: '#52a886',
  },
};

export const TYPOGRAPHY_TOKENS: TypographyTokens = {
  fontFamily: '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", "MS PMincho", serif',
  uiFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif',
  cellFontSize: '18px',
  rubyFontSize: '9px',
  hangingFontSize: '12px',
  toolbarFontSize: '12px',
  fontWeightNormal: '400',
  fontWeightBold: '600',
};

export const SPACING_AND_GRID_TOKENS: SpacingAndGridTokens = {
  cellSize: '30px',
  rubyGap: '13px',
  hashiraWidth: '28px',
  pagePadding: '28px',
  pageGap: '32px',
  toolbarHeight: '42px',
  spacingXs: '4px',
  spacingSm: '8px',
  spacingMd: '12px',
  spacingLg: '20px',
};

export const SHAPE_AND_SHADOW_TOKENS: ShapeAndShadowTokens = {
  borderRadiusSm: '4px',
  borderRadiusMd: '6px',
  pageShadow: '0 4px 18px rgba(0, 0, 0, 0.12)',
  modalShadow: '0 8px 24px rgba(0, 0, 0, 0.22)',
  outerBorderWidth: '2px',
  innerBorderWidth: '1px',
};

/**
 * 指定されたテーマと設定から CSS カスタムプロパティ宣言文字列を生成する
 */
export function buildCssVariables(config: GenkouConfig): string {
  const palette = COLOR_PALETTES[config.gridColor] ?? COLOR_PALETTES.green;
  return [
    `--genkou-paper-bg: ${palette.paperBg};`,
    `--genkou-canvas-bg: ${palette.canvasBg};`,
    `--genkou-grid-primary: ${palette.gridPrimary};`,
    `--genkou-grid-sub: ${palette.gridSub};`,
    `--genkou-text-main: ${palette.textMain};`,
    `--genkou-text-dialogue: ${palette.textDialogue};`,
    `--genkou-text-ruby: ${palette.textRuby};`,
    `--genkou-text-muted: ${palette.textMuted};`,
    `--genkou-cursor-bg: ${palette.cursorBg};`,
    `--genkou-cursor-border: ${palette.cursorBorder};`,
    `--genkou-active-cell-bg: ${palette.activeCellBg};`,
    `--genkou-toolbar-bg: ${palette.toolbarBg};`,
    `--genkou-toolbar-border: ${palette.toolbarBorder};`,
    `--genkou-accent-color: ${palette.accentColor};`,
    `--genkou-font-family: ${TYPOGRAPHY_TOKENS.fontFamily};`,
    `--genkou-ui-font-family: ${TYPOGRAPHY_TOKENS.uiFontFamily};`,
    `--genkou-cell-font-size: ${TYPOGRAPHY_TOKENS.cellFontSize};`,
    `--genkou-ruby-font-size: ${TYPOGRAPHY_TOKENS.rubyFontSize};`,
    `--genkou-hanging-font-size: ${TYPOGRAPHY_TOKENS.hangingFontSize};`,
    `--genkou-toolbar-font-size: ${TYPOGRAPHY_TOKENS.toolbarFontSize};`,
    `--genkou-font-weight-normal: ${TYPOGRAPHY_TOKENS.fontWeightNormal};`,
    `--genkou-font-weight-bold: ${TYPOGRAPHY_TOKENS.fontWeightBold};`,
    `--genkou-cell-size: ${SPACING_AND_GRID_TOKENS.cellSize};`,
    `--genkou-ruby-gap: ${SPACING_AND_GRID_TOKENS.rubyGap};`,
    `--genkou-hashira-width: ${SPACING_AND_GRID_TOKENS.hashiraWidth};`,
    `--genkou-page-padding: ${SPACING_AND_GRID_TOKENS.pagePadding};`,
    `--genkou-page-gap: ${SPACING_AND_GRID_TOKENS.pageGap};`,
    `--genkou-toolbar-height: ${SPACING_AND_GRID_TOKENS.toolbarHeight};`,
    `--genkou-spacing-xs: ${SPACING_AND_GRID_TOKENS.spacingXs};`,
    `--genkou-spacing-sm: ${SPACING_AND_GRID_TOKENS.spacingSm};`,
    `--genkou-spacing-md: ${SPACING_AND_GRID_TOKENS.spacingMd};`,
    `--genkou-spacing-lg: ${SPACING_AND_GRID_TOKENS.spacingLg};`,
    `--genkou-border-radius-sm: ${SHAPE_AND_SHADOW_TOKENS.borderRadiusSm};`,
    `--genkou-border-radius-md: ${SHAPE_AND_SHADOW_TOKENS.borderRadiusMd};`,
    `--genkou-page-shadow: ${SHAPE_AND_SHADOW_TOKENS.pageShadow};`,
    `--genkou-modal-shadow: ${SHAPE_AND_SHADOW_TOKENS.modalShadow};`,
    `--genkou-outer-border-width: ${SHAPE_AND_SHADOW_TOKENS.outerBorderWidth};`,
    `--genkou-inner-border-width: ${SHAPE_AND_SHADOW_TOKENS.innerBorderWidth};`,
    `--genkou-chars-per-line: ${config.charsPerLine};`,
    `--genkou-lines-per-page: ${config.linesPerPage};`,
  ].join('\n');
}

/**
 * Host ⇔ Webview メッセージングプロトコル
 */
export type HostToWebviewMessage =
  | {
      type: 'INIT_DOCUMENT';
      text: string;
      config: GenkouConfig;
      version: number;
      fileName: string;
    }
  | {
      type: 'DOCUMENT_CHANGED';
      text: string;
      version: number;
    }
  | {
      type: 'CONFIG_CHANGED';
      config: GenkouConfig;
    };

export type WebviewToHostMessage =
  | { type: 'READY' }
  | {
      type: 'EDIT_TEXT';
      text: string;
      version: number;
    }
  | {
      type: 'UPDATE_CONFIG';
      partialConfig: Partial<GenkouConfig>;
    }
  | {
      type: 'REQUEST_EXPORT';
      format: 'html' | 'combined';
    };
