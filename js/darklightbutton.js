document.addEventListener("DOMContentLoaded", () => {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  const applyTheme = (theme) => {
    document.body.setAttribute("data-theme", theme);
  };

  // 1) При первой загрузке — применяем системную тему
  applyTheme(prefersDark.matches ? "dark" : "light");

  // 2) Если система поменяла тему — обновляем сайт
  prefersDark.addEventListener("change", (e) => {
    applyTheme(e.matches ? "dark" : "light");
  });
});