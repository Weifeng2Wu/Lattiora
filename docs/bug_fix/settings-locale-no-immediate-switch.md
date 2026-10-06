# Settings 切换语言不立即生效（#437）

## 现象

设置窗口 Appearance → Language 切换后，设置界面文案仍是旧语言；关闭再开或刷新设置窗后才切换。

## 根因

设置是独立轻量 webview（`SettingsNativeRoot`），不挂载主窗的 `useAppBootstrap`。后者才在 `settings.locale` 变化时调用 `i18n.changeLanguage`。设置窗只更新并落盘 settings，本窗 i18n 语言不变，故 `useTranslation` 仍返回旧文案。

## 修复

- 抽出 `applyLocale`（`src/i18n/index.ts`）：`changeLanguage` + `<html lang>`。
- `SettingsNativeRoot` 在 `settings.locale` 变化时立即 `applyLocale`（并同步原生菜单 `set_locale`）。
- `main.tsx` 的 `subscribeSettings` 对各窗口再应用一次，覆盖 feature/doc 等未挂 bootstrap 的窗。

## 相关

- Issue: #437
- 代码：`src/components/settings/settings-native-root.tsx`、`src/i18n/index.ts`、`src/main.tsx`、`src/hooks/use-app-bootstrap.ts`
