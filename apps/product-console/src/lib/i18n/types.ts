export type Locale = "zh-CN" | "en";
export type ViewKey = "overview" | "board" | "spec" | "runner" | "reviews" | "settings";

export type TranslationCatalog = Record<string, unknown> & {
  nav: Record<ViewKey, string>;
  ofTasks: (start: number, end: number, total: number) => string;
  reviewsTitle: (count: number) => string;
  itemsTotal: (total: number) => string;
};
