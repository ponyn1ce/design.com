// js/order.js — multi-step order form + local persistence
(function(){
  // Placeholder server endpoint. For sending to Telegram you should implement
  // a backend endpoint that accepts JSON/multipart and forwards to Telegram Bot API.
  const BOT_ENDPOINT = ''; // e.g. 'https://your-server.example.com/sendToTelegram'

  const catalog = [
    { id: 'classic', title: 'Классический', img: 'images/test.png' },
    { id: 'modern', title: 'Модерн', img: 'images/test.png' },
    { id: 'minimal', title: 'Минимал', img: 'images/test.png' }
  ];

  const stateKey = 'orderDraft_v1';
  const state = JSON.parse(localStorage.getItem(stateKey) || '{}');

  // Elements
  const catalogList = document.getElementById('catalog-list');
  const toStep2Btn = document.getElementById('to-step-2');
  const pagesSelect = document.getElementById('pages-count');
  const toStep3Btn = document.getElementById('to-step-3');
  const backStep1 = document.getElementById('back-step-1');
  const backStep2 = document.getElementById('back-step-2');
  const uploaderGrid = document.getElementById('uploader-grid');
  const totalPagesEl = document.getElementById('total-pages');
  const submitBtn = document.getElementById('submit-order');
  // view mode: 'grid' or 'single'
  if(!state.viewMode) state.viewMode = 'grid';
  // window start for single-view (zero-based index of first visible item)
  if(typeof state.windowStart === 'undefined') state.windowStart = 0;
  // По умолчанию размер окна (сколько показывать одновременно) — изменено: 12
  const DEFAULT_WINDOW_SIZE = 12;
  const MOBILE_WINDOW_SIZE = 10; // на мобильных показываем 10
  function getWindowSize(){
    try{
      // на мобильных устройствах (<768) показываем MOBILE_WINDOW_SIZE
      if(window.matchMedia && window.matchMedia('(max-width: 767px)').matches) return MOBILE_WINDOW_SIZE;
    }catch(e){}
    return DEFAULT_WINDOW_SIZE;
  }
  function saveState(){ return safeSaveState(); }

  // Save with Quota handling: if localStorage quota exceeded, strip large image dataURLs
  function safeSaveState(){
    try{
      localStorage.setItem(stateKey, JSON.stringify(state));
      return true;
    }catch(e){
      if(e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)){
        console.warn('LocalStorage quota exceeded — attempting fallback by stripping inline image data.');
        // Replace large data URLs in state.photos with null placeholders (keep metadata if any)
        if(Array.isArray(state.photos)){
          for(let i=0;i<state.photos.length;i++){
            const v = state.photos[i];
            if(!v) continue;
            // if it's a data URL string, remove it to free space
            if(typeof v === 'string' && v.startsWith('data:')){
              state.photos[i] = null;
            }
            // if it's an object with large dataUrl property, strip it
            if(typeof v === 'object' && v.dataUrl){ state.photos[i] = null; }
          }
        }
        try{ localStorage.setItem(stateKey, JSON.stringify(state)); return true; }catch(e2){ console.error('Failed to save state even after stripping images', e2); return false; }
      }
      console.error('saveState failed', e);
      return false;
    }
  }

  // Ensure state.photos is an array with length = count (fills with nulls)
  function ensurePhotosArray(count){
    if(!state.photos || !Array.isArray(state.photos)) state.photos = [];
    for(let i=0;i<count;i++) if(typeof state.photos[i] === 'undefined') state.photos[i] = null;
    // trim if longer
    if(state.photos.length > count) state.photos.length = count;
    saveState();
  }

  // --- Step 1: render catalog ---
  function renderCatalog(){
    catalogList.innerHTML = '';
    // применяем класс сетки, чтобы каталог выглядел как сетка загрузчика
    catalogList.classList.add('catalog-grid');
    catalog.forEach(item => {
      const el = document.createElement('div'); el.className = 'catalog-item';
      el.dataset.id = item.id;
      el.innerHTML = `<img src="${item.img}" alt="${item.title}"><div>${item.title}</div>`;
      if(state.catalog === item.id) el.classList.add('selected');
      el.addEventListener('click', ()=>{
        state.catalog = item.id; saveState();
        document.querySelectorAll('.catalog-item').forEach(x=>x.classList.remove('selected'));
        el.classList.add('selected');
        toStep2Btn.disabled = false;
        // send intermediate step
        sendPartial('catalog', { catalog: item.id });
      });
      catalogList.appendChild(el);
    });
    toStep2Btn.disabled = !state.catalog;
  }

  // --- Step 2: pages select ---
  function renderPagesOptions(){
    pagesSelect.innerHTML = '';
    for(let i=30;i<=100;i+=10){
      const o = document.createElement('option'); o.value = i; o.textContent = i + ' страниц';
      pagesSelect.appendChild(o);
    }
    if(state.pages) pagesSelect.value = state.pages;
  }

  // --- Step 3: uploader ---
  // controls exist in HTML (`#uploader-controls`) — listeners are wired on DOMContentLoaded

  function updateControlsForSingle(count){
    const info = document.getElementById('view-info');
    const prev = document.getElementById('pager-prev');
    const next = document.getElementById('pager-next');
    if(!info || !prev || !next) return;
    // window of up to N items (N depends on device)
    const start = state.windowStart || 0;
    const w = getWindowSize();
    const end = Math.min(count, start + w) - 1;
    info.textContent = `Показано ${start+1}–${end+1} из ${count}`;
    prev.disabled = start <= 0;
    next.disabled = end >= count-1;
  }

  // helper: check if at least one photo uploaded
  function hasAtLeastOnePhoto(){
    if(!Array.isArray(state.photos)) return false;
    return state.photos.some(p => !!p);
  }

  // enable/disable navigation buttons based on selections
  function updateNextButtons(){
    try{
      if(toStep3Btn) toStep3Btn.disabled = !(pagesSelect && +pagesSelect.value > 0);
      const toStep4Btn = document.getElementById('to-step-4');
      if(toStep4Btn) toStep4Btn.disabled = !hasAtLeastOnePhoto();
    }catch(e){ console.warn(e); }
  }

  function buildUploader(count){
    uploaderGrid.innerHTML = '';
    totalPagesEl.textContent = count;
    ensurePhotosArray(count);
    // toggle class for single view
    if(state.viewMode === 'single') uploaderGrid.classList.add('single-view'); else uploaderGrid.classList.remove('single-view');

    // helper to create a cell for index
    function createCellFor(idx){
      const cell = document.createElement('label');
      cell.className = 'uploader-cell';
      cell.dataset.index = idx;
      cell.draggable = !!state.photos[idx];
      cell.innerHTML = `
        <div class="num">${idx+1}</div>
        <div class="placeholder">Загрузить</div>
        <input type="file" accept="image/*" data-index="${idx}">
        <img class="preview" src="" alt="" style="display:none">
        <button class="delete-btn" type="button" style="display:none">Удалить</button>
      `;

      const input = cell.querySelector('input[type=file]');
      const preview = cell.querySelector('img.preview');
      const delBtn = cell.querySelector('.delete-btn');

      // показать увеличенное превью по клику (лайтбокс)
      preview.addEventListener('click', ()=>{
        if(!preview.src) return;
        openLightbox(preview.src);
      });

      input.addEventListener('change', async (e)=>{
        const f = e.target.files[0];
        if(!f) return;
        const data = await fileToDataUrl(f);
        state.photos[idx] = data; saveState();
        preview.src = data; preview.style.display = 'block';
        delBtn.style.display = 'block';
        cell.draggable = true;
        sendPartial('photo', { index: idx+1, dataUrl: data });
      });

      // if have saved image, show
      if(state.photos && state.photos[idx]){
        preview.src = state.photos[idx]; preview.style.display = 'block';
        delBtn.style.display = 'block';
        cell.draggable = true;
      }

      // delete handler — only shown when photo present
      delBtn.addEventListener('click', (ev)=>{
        ev.preventDefault(); ev.stopPropagation();
        state.photos.splice(idx,1); // remove the item
        // keep array length: push null at end to maintain total slots
        state.photos.push(null);
        saveState();
        // rebuild to update numbering and draggable state
        buildUploader(count);
        sendPartial('photo_delete', { index: idx+1 });
      });

      // Drag & Drop
      cell.addEventListener('dragstart', (e)=>{
        if(!state.photos[idx]){ e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', String(idx));
        cell.classList.add('dragging');
      });
      cell.addEventListener('dragend', ()=>{ cell.classList.remove('dragging'); });

      cell.addEventListener('dragover', (e)=>{ e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', ()=>{ cell.classList.remove('drag-over'); });
      cell.addEventListener('drop', (e)=>{
        e.preventDefault(); cell.classList.remove('drag-over');
        const from = parseInt(e.dataTransfer.getData('text/plain'),10);
        const to = idx;
        if(isNaN(from) || from===to) return;
        // animate visual move, then update state and rebuild
        animateMove(from, to, ()=>{
          const item = state.photos.splice(from,1)[0];
          state.photos.splice(to,0,item);
          // ensure length remains count
          if(state.photos.length > count) state.photos.length = count;
          while(state.photos.length < count) state.photos.push(null);
          saveState();
          buildUploader(count);
          sendPartial('photo_move', { from: from+1, to: to+1 });
        });
      });

      return cell;
    }

    if(state.viewMode === 'single'){
      // show a window of up to W items starting at state.windowStart (W depends on device)
      let start = state.windowStart || 0;
      if(start < 0) start = 0;
      if(start > count-1) start = Math.max(0, count-1);
      state.windowStart = start;
      const w = getWindowSize();
      const end = Math.min(count, start + w);
      for(let idx = start; idx < end; idx++){
        const cell = createCellFor(idx);
        uploaderGrid.appendChild(cell);
      }
      updateControlsForSingle(count);
      return;
    }

    for(let i=0;i<count;i++){
      const idx = i; // zero-based
      const cell = createCellFor(idx);
      uploaderGrid.appendChild(cell);
    }
    // обновить доступность кнопки перехода на шаг 4
    updateNextButtons();
  }

  // ЛАЙТБОКС: открыть/закрыть увеличенное изображение
  function openLightbox(src){
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    if(!lb || !img) return;
    img.src = src;
    lb.style.display = 'flex';
  }
  function closeLightbox(){
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    if(!lb || !img) return;
    img.src = '';
    lb.style.display = 'none';
  }

  function fileToDataUrl(file){
    // Read file and downscale/compress to reasonable size to avoid hitting localStorage quota
    return new Promise((res, rej)=>{
      const img = new Image();
      const reader = new FileReader();
      reader.onerror = rej;
      reader.onload = ()=>{
        img.onload = ()=>{
          try{
            const MAX_DIM = 1200; // max width/height
            let w = img.width, h = img.height;
            if(w > MAX_DIM || h > MAX_DIM){
              const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
              w = Math.round(w * ratio); h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
            // quality 0.8 to reduce size
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            res(dataUrl);
          }catch(err){
            // fallback to raw dataURL
            res(reader.result);
          }
        };
        img.onerror = ()=>{ res(reader.result); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // animate move: clone source cell and animate to target position, then call cb
  function animateMove(fromIndex, toIndex, cb){
    const fromElem = uploaderGrid.querySelector(`[data-index="${fromIndex}"]`);
    const toElem = uploaderGrid.querySelector(`[data-index="${toIndex}"]`);
    if(!fromElem || !toElem){ cb(); return; }
    const fromRect = fromElem.getBoundingClientRect();
    const toRect = toElem.getBoundingClientRect();
    // clone
    const clone = fromElem.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.zIndex = 9999;
    clone.style.left = fromRect.left + 'px';
    clone.style.top = fromRect.top + 'px';
    clone.style.width = fromRect.width + 'px';
    clone.style.height = fromRect.height + 'px';
    clone.classList.add('move-clone');
    document.body.appendChild(clone);
    // compute translation
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;
    // trigger transition
    requestAnimationFrame(()=>{
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;
      clone.style.opacity = '0.9';
    });
    clone.addEventListener('transitionend', function te(){
      clone.removeEventListener('transitionend', te);
      document.body.removeChild(clone);
      cb();
    });
    // safety fallback
    setTimeout(()=>{ if(document.body.contains(clone)){ try{ document.body.removeChild(clone); }catch(e){}; cb(); } }, 700);
  }

  // Partial send (step by step) — attempt to POST to BOT_ENDPOINT if set
  async function sendPartial(type, payload){
    if(!BOT_ENDPOINT) return; // not configured
    try{
      await fetch(BOT_ENDPOINT, {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({type, payload, timestamp: Date.now()})
      });
    }catch(e){ console.warn('sendPartial failed', e); }
  }

  // Final submit: send whole state
  async function submitOrder(){
    submitBtn.disabled = true; submitBtn.textContent = 'Отправка...';
    if(!BOT_ENDPOINT){
      console.log('Order payload (no BOT_ENDPOINT set):', state);
      alert('BОтправка: в конфигурации отсутствует серверный endpoint. Проверьте консоль.');
      submitBtn.disabled = false; submitBtn.textContent = 'Отправить заказ';
      return;
    }
    try{
      const res = await fetch(BOT_ENDPOINT, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({type:'final', order:state}) });
      if(!res.ok) throw new Error('network');
      alert('Заказ отправлен');
      // clear draft
      localStorage.removeItem(stateKey);
    }catch(e){
      console.error(e); alert('Ошибка отправки. Смотрите консоль.');
    }finally{ submitBtn.disabled = false; submitBtn.textContent = 'Отправить заказ'; }
  }

  // Init handlers
  document.addEventListener('DOMContentLoaded', ()=>{
    renderCatalog(); renderPagesOptions();

    toStep2Btn.addEventListener('click', ()=>{ document.getElementById('step-1').style.display='none'; document.getElementById('step-2').style.display='block'; });
    backStep1.addEventListener('click', ()=>{ document.getElementById('step-2').style.display='none'; document.getElementById('step-1').style.display='block'; });
    toStep3Btn.addEventListener('click', ()=>{
      state.pages = +pagesSelect.value; saveState();
      document.getElementById('step-2').style.display='none'; document.getElementById('step-3').style.display='block';
      buildUploader(state.pages);
    });
    backStep2.addEventListener('click', ()=>{ document.getElementById('step-3').style.display='none'; document.getElementById('step-2').style.display='block'; });

    // Навигация: перейти к шагу 4 (форма контактов)
    const toStep4 = document.getElementById('to-step-4');
    if(toStep4) toStep4.addEventListener('click', ()=>{
      // сохранить текущее состояние страниц
      state.pages = +pagesSelect.value || state.pages;
      saveState();
      document.getElementById('step-3').style.display='none';
      document.getElementById('step-4').style.display='block';
      // если в state уже есть данные контакта — заполнить форму
      const nameEl = document.getElementById('customer-name');
      const emailEl = document.getElementById('customer-email');
      const noteEl = document.getElementById('customer-note');
      if(state.customer){ if(nameEl) nameEl.value = state.customer.name || ''; if(emailEl) emailEl.value = state.customer.email || ''; if(noteEl) noteEl.value = state.customer.note || ''; }
    });

    // возврат из шага 4 в шаг 3
    const backStep3 = document.getElementById('back-step-3');
    if(backStep3) backStep3.addEventListener('click', ()=>{ document.getElementById('step-4').style.display='none'; document.getElementById('step-3').style.display='block'; buildUploader(state.pages || 0); });

    // финальная отправка — кнопка на шаге 4
    const finalSubmit = document.getElementById('submit-order');
    if(finalSubmit) finalSubmit.addEventListener('click', async ()=>{
      // собрать контактные данные и сохранить
      const nameEl = document.getElementById('customer-name');
      const emailEl = document.getElementById('customer-email');
      const noteEl = document.getElementById('customer-note');
      state.customer = { name: nameEl?.value || '', email: emailEl?.value || '', note: noteEl?.value || '' };
      saveState();
      // простая валидация email
      if(state.customer.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.customer.email)){
        alert('Пожалуйста, введите корректный email');
        return;
      }
      await submitOrder();
    });

    // wire static controls (created in HTML)
    const toggle = document.getElementById('toggle-view');
    const prev = document.getElementById('pager-prev');
    const next = document.getElementById('pager-next');
    const info = document.getElementById('view-info');
    if(toggle){ toggle.textContent = state.viewMode === 'single' ? 'Просмотр: страница' : 'Просмотр: сетка'; toggle.addEventListener('click', ()=>{ state.viewMode = state.viewMode === 'single' ? 'grid' : 'single'; saveState(); toggle.textContent = state.viewMode === 'single' ? 'Просмотр: страница' : 'Просмотр: сетка'; buildUploader(state.pages || 0); }); }
    if(prev) prev.addEventListener('click', ()=>{ state.windowStart = Math.max(0, (state.windowStart||0)- getWindowSize()); saveState(); buildUploader(state.pages || 0); });
    if(next) next.addEventListener('click', ()=>{ state.windowStart = Math.min(Math.max(0, (state.pages||0)-1), (state.windowStart||0)+ getWindowSize()); saveState(); buildUploader(state.pages || 0); });

    // Кнопка "Удалить все" — ВРЕМЕННАЯ ФУНКЦИЯ ДЛЯ УДАЛЕНИЯ ВСЕХ ЗАГРУЖЕННЫХ ФОТО
    // Этот код добавлен по просьбе владельца; в будущем можно удалить.
    const deleteAllBtn = document.getElementById('delete-all-btn') || document.getElementById('delete-all');
    if(deleteAllBtn){
      deleteAllBtn.addEventListener('click', ()=>{
        if(!confirm('Удалить все загруженные фотографии? Это действие необратимо.')) return;
        // если нет заданного количества страниц — ничего не делаем
        const cnt = state.pages || 0;
        state.photos = [];
        for(let i=0;i<cnt;i++) state.photos.push(null);
        saveState();
        buildUploader(cnt);
        // уведомление на сервер при наличии endpoint
        sendPartial('photo_delete_all', { count: cnt });
      });
    }

    // Лайтбокс: закрыть
    const lb = document.getElementById('lightbox');
    const lbClose = document.getElementById('lightbox-close');
    if(lb){
      lb.addEventListener('click', (e)=>{ if(e.target === lb) closeLightbox(); });
    }
    if(lbClose) lbClose.addEventListener('click', closeLightbox);

    // enable/disable next from step1
    toStep2Btn.disabled = !state.catalog;

    // На мобильных устройствах (<768px) принудительно включаем single-view и прячем переключатель
    try{
      if(window.matchMedia && window.matchMedia('(max-width: 767px)').matches){
        state.viewMode = 'single';
        state.windowStart = state.windowStart || 0;
        const toggleEl = document.getElementById('toggle-view');
        if(toggleEl) toggleEl.style.display = 'none';
      }
    }catch(e){}

    // pages select change
    pagesSelect.addEventListener('change', ()=>{ state.pages = +pagesSelect.value; saveState(); updateNextButtons(); });

    // initial update for buttons
    updateNextButtons();

    // if state suggests we were mid-way, restore
    if(state.pages && state.catalog && state.photos){
      // show step3
      document.getElementById('step-1').style.display='none';
      document.getElementById('step-2').style.display='none';
      document.getElementById('step-3').style.display='block';
      buildUploader(state.pages);
    }
  });

})();
