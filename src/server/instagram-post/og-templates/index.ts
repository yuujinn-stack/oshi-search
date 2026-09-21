/**
 * og-render.tsx（生成ロジック）から見た入口。
 * 中身がtheme.ts / shared.tsx / page1〜3.tsxに分割されていることを意識せず、
 * 従来どおりbuildPage*Element と CANVAS_WIDTH / CANVAS_HEIGHT だけを使えるようにする。
 */
import { CANVAS } from './theme';

export const CANVAS_WIDTH = CANVAS.width;
export const CANVAS_HEIGHT = CANVAS.height;

export { buildPage1Element } from './page1';
export type { Page1Data } from './page1';
export { buildPage2Element } from './page2';
export type { Page2Data, Page2WorkData } from './page2';
export { buildPage3Element } from './page3';
export type { Page3Data } from './page3';
