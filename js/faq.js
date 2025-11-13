// faq.js — простая логика аккордеона для FAQ
document.addEventListener('DOMContentLoaded', function () {
  function toggleItem(item) {
    const isOpen = item.classList.toggle('open');
    const btn = item.querySelector('.faq-toggle');
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  // клики по кнопке + по вопросу
  document.querySelectorAll('.faq-item').forEach(item => {
    const btn = item.querySelector('.faq-toggle');
    const q = item.querySelector('.faq-question');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleItem(item);
      });
    }
    if (q) {
      q.addEventListener('click', function (e) {
        e.preventDefault();
        toggleItem(item);
      });
    }
  });

  // keyboard support: Enter / Space on question or toggle
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      const active = document.activeElement;
      if (active && (active.classList.contains('faq-question') || active.classList.contains('faq-toggle'))) {
        e.preventDefault();
        const item = active.closest('.faq-item');
        if (item) toggleItem(item);
      }
    }
  });
});
