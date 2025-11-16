import React, { useRef, useEffect, useState } from 'react'
import { fabric } from 'fabric'
import './editor.css'

// Simple IndexedDB helper for storing image blobs
function openDb(){
  return new Promise((res, rej)=>{
    // Open DB at version 2 so we can create multiple object stores if needed
    const rq = indexedDB.open('maket-images', 2)
    rq.onupgradeneeded = ()=>{
      const db = rq.result
      if(!db.objectStoreNames.contains('imgs')) db.createObjectStore('imgs')
      if(!db.objectStoreNames.contains('spreads')) db.createObjectStore('spreads')
    }
    rq.onsuccess = ()=> res(rq.result)
    rq.onerror = ()=> rej(rq.error)
  })
}
async function saveSpreadJson(key, jsonStr){
  const db = await openDb();
  return new Promise((res, rej)=>{
    const tx = db.transaction('spreads','readwrite'); const store = tx.objectStore('spreads');
    const rq = store.put(jsonStr, key)
    rq.onsuccess = ()=>{ res(true); db.close(); }
    rq.onerror = ()=>{ rej(rq.error); db.close(); }
  })
}
async function getSpreadJson(key){
  const db = await openDb();
  return new Promise((res, rej)=>{
    const tx = db.transaction('spreads','readonly'); const store = tx.objectStore('spreads');
    const rq = store.get(key)
    rq.onsuccess = ()=>{ res(rq.result); db.close(); }
    rq.onerror = ()=>{ rej(rq.error); db.close(); }
  })
}
async function deleteSpreadJson(key){
  const db = await openDb();
  return new Promise((res, rej)=>{
    const tx = db.transaction('spreads','readwrite'); const store = tx.objectStore('spreads');
    const rq = store.delete(key)
    rq.onsuccess = ()=>{ res(true); db.close(); }
    rq.onerror = ()=>{ rej(rq.error); db.close(); }
  })
}
async function saveBlob(key, blob){
  const db = await openDb();
  return new Promise((res, rej)=>{
    const tx = db.transaction('imgs','readwrite'); const store = tx.objectStore('imgs');
    const rq = store.put(blob, key);
    rq.onsuccess = ()=>{ res(true); db.close(); };
    rq.onerror = ()=>{ rej(rq.error); db.close(); };
  })
}
async function getBlob(key){
  const db = await openDb();
  return new Promise((res, rej)=>{
    const tx = db.transaction('imgs','readonly'); const store = tx.objectStore('imgs');
    const rq = store.get(key);
    rq.onsuccess = ()=>{ res(rq.result); db.close(); };
    rq.onerror = ()=>{ rej(rq.error); db.close(); };
  })
}

export default function Editor(){
  const canvasRef = useRef(null)
  const fabricRef = useRef(null)
  const [theme, setTheme] = useState('light')
  const [activePage, setActivePage] = useState('left')
  const [objectsList, setObjectsList] = useState([])
  const undoStack = useRef([])
  const redoStack = useRef([])
  // PAGE_SCALE controls how large A4 pages render relative to available viewport.
  // Increase for bigger page visuals, decrease to shrink.
  // On mobile (<768px), pages are scaled 2x larger to fill screen
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const PAGE_SCALE = isMobile ? 1.2 : 0.6
  // A4 metric constants (mm -> px conversion using 96dpi)
  const A4_MM_W = 210
  const A4_MM_H = 297
  const PX_PER_MM = 96 / 25.4 // ~= 3.7795

  // Color panel state for text color picker
  const [colorPanelOpen, setColorPanelOpen] = useState(false)
  const [selectedColor, setSelectedColor] = useState('#000000')
  // Project pagination: pages and spreads
  const [totalPages, setTotalPages] = useState(30)
  const [currentSpread, setCurrentSpread] = useState(0) // 0 == cover (page 1)
  const [savedSpreads, setSavedSpreads] = useState([]) // metadata list [{id, spread, pages, ts}]
  const [pagesPanelOpen, setPagesPanelOpen] = useState(true)
  const [justAddedSpread, setJustAddedSpread] = useState(null)
  const [zoom, setZoom] = useState(1)
  const autosaveTimer = useRef(null)
  const autosaveDelay = 2000
  const [thumbnailsOpen, setThumbnailsOpen] = useState(true) // Toggle thumbnails panel

  useEffect(()=>{
    // Theme detection
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = ()=> setTheme(mq.matches ? 'dark' : 'light')
    applyTheme()
    mq.addEventListener?.('change', applyTheme)

    const el = canvasRef.current
    const canvas = new fabric.Canvas(el, { backgroundColor: 'transparent', preserveObjectStacking: true })
    fabricRef.current = canvas

    function resize(){
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.setWidth(w)
      canvas.setHeight(h)
      renderPages(canvas, w, h, theme)
      canvas.renderAll()
    }

    // initial size
    resize()
    window.addEventListener('resize', resize)

    // cleanup
    return ()=>{
      window.removeEventListener('resize', resize)
      mq.removeEventListener?.('change', applyTheme)
      canvas.dispose()
    }
  }, [])

  useEffect(()=>{
    // update pages colors on theme change
    const canvas = fabricRef.current
    if(!canvas) return
    renderPages(canvas, canvas.getWidth(), canvas.getHeight(), theme)
    // also update root background (empty area)
    const root = document.querySelector('.editor-root')
    if(root) root.className = `editor-root ${theme}`
    canvas.renderAll()
  }, [theme])

  // Redraw pages when zoom changes
  useEffect(()=>{
    const canvas = fabricRef.current
    if(!canvas) return
    renderPages(canvas, canvas.getWidth(), canvas.getHeight(), theme)
    canvas.renderAll()
  }, [zoom])

  // wire canvas events: history, constrain to page, object list
  useEffect(()=>{
    const canvas = fabricRef.current
    if(!canvas) return
    const pushOnChange = ()=>{ try{ const json = canvas.toJSON(['pageMarker','_id','_storeKey']); undoStack.current.push(json); if(undoStack.current.length>50) undoStack.current.shift(); redoStack.current = []; }catch(e){}; refreshObjectsList(); scheduleAutoSave(); }
    const updateClipAndConstrain = (obj)=>{ if(!obj) return; constrainToPage(obj); assignClipToObject(obj); }
    const onModified = (e)=>{ const obj = e.target; updateClipAndConstrain(obj); pushOnChange(); }
    const onAdded = (e)=>{ const obj = e.target; assignClipToObject(obj); pushOnChange(); }
    const onRemoved = (e)=>{ pushOnChange(); }
    canvas.on('object:added', onAdded)
    canvas.on('object:modified', onModified)
    // shift-to-scale uniform: handle scaling event
    canvas.on('object:moving', (e)=>{ assignClipToObject(e.target) })
    canvas.on('object:scaling', (e)=>{
      const obj = e.target
      // if user holds Shift, enforce uniform scaling
      try{
        const evt = e.e || window.event
        if(evt && evt.shiftKey){ obj.scaleY = obj.scaleX }
      }catch(ex){}
      assignClipToObject(obj)
    })
    canvas.on('object:removed', onRemoved)
    // initial push
    try{ undoStack.current.push(canvas.toJSON(['pageMarker','_id','_storeKey'])); }catch(e){}
    refreshObjectsList()
    return ()=>{
      canvas.off('object:added', onAdded)
      canvas.off('object:modified', onModified)
      canvas.off('object:moving')
      canvas.off('object:scaling')
      canvas.off('object:removed', onRemoved)
    }
  }, [fabricRef.current])

  function renderPages(canvas, w, h, theme, spreadOverride){
    // Remove previous page backgrounds and labels
    canvas.getObjects('rect').forEach(o=>{ if(o?.pageMarker || o?.pageLabel) canvas.remove(o) })
    canvas.getObjects('text').forEach(o=>{ if(o?.pageLabel) canvas.remove(o) })

    const gutterBase = Math.max(24, Math.floor(w * 0.02))
    const padding = 40

    // Compute A4 pixel size then scale to fit available area while preserving ratio
    const a4PxW = Math.round(A4_MM_W * PX_PER_MM)
    const a4PxH = Math.round(A4_MM_H * PX_PER_MM)
    // maximum scale to fit two pages side-by-side and height
    const maxScaleByWidth = (w - padding*2 - gutterBase) / (2 * a4PxW)
    const maxScaleByHeight = (h - padding*2) / a4PxH
    const fitScale = Math.max(0.1, Math.min(maxScaleByWidth, maxScaleByHeight))
    const finalScale = fitScale * PAGE_SCALE * (zoom || 1)
    const pageW = Math.max(120, Math.floor(a4PxW * finalScale))
    const pageH = Math.max(140, Math.floor(a4PxH * finalScale))
    // choose gutter: keep default for cover, halve it for content spreads
    const cs = (typeof spreadOverride === 'number') ? spreadOverride : ((typeof currentSpread === 'number') ? currentSpread : 0)
    const gutter = cs === 0 ? gutterBase : Math.max(8, Math.floor(gutterBase/2))
    const leftX = (w - (pageW*2 + gutter))/2
    const rightX = leftX + pageW + gutter
    // account for thumbnails panel at bottom when centering vertically
    let thumbnailsHeightRaw = getComputedStyle(document.documentElement).getPropertyValue('--thumbnails-height')
    let thumbnailsHeight = 0
    if(thumbnailsHeightRaw){
      const parsed = parseInt(thumbnailsHeightRaw)
      thumbnailsHeight = Number.isFinite(parsed) ? parsed : (isMobile ? 150 : 180)
    } else thumbnailsHeight = isMobile ? 150 : 180
    const availableHeight = Math.max(200, h - thumbnailsHeight - padding)
    const y = Math.max(20, Math.floor((availableHeight - pageH)/2))

    // Pages themselves remain light (working area). The empty area / site background becomes dark in dark theme.
    const pageFill = '#ffffff'
    const pageStroke = theme === 'dark' ? '#444' : '#ddd'

    // set canvas background (empty area) to match root theme background for comfortable workspace
    const root = document.querySelector('.editor-root')
    if(root){
      const bg = getComputedStyle(root).getPropertyValue('--bg') || (theme === 'dark' ? '#202123' : '#f6f6f8')
      try{ canvas.setBackgroundColor(bg.trim() || (theme === 'dark' ? '#060608' : '#f6f6f8'), canvas.renderAll.bind(canvas)) }catch(e){}
    }

    // Create left/right page rects sized according to A4 proportions.
    // If currentSpread === 0 -> show two cover pages (pages 1-2) side-by-side.
    // On desktop, add page number labels above each page.
    const isDesktop = !isMobile
    if(cs === 0){
      // two cover pages (left and right) shown side-by-side; these are not part of totalPages count
      const left = new fabric.Rect({ left:leftX, top:y, width:pageW, height:pageH, fill:pageFill, stroke:pageStroke, strokeWidth:1, selectable:false, rx:6, ry:6 })
      left.pageMarker = 'cover-left'
      left.isLocked = false  // cover not locked anymore
      const right = new fabric.Rect({ left:rightX, top:y, width:pageW, height:pageH, fill:pageFill, stroke:pageStroke, strokeWidth:1, selectable:false, rx:6, ry:6 })
      right.pageMarker = 'cover-right'
      right.isLocked = false  // second cover page is editable
      canvas.add(left)
      canvas.add(right)
      canvas.sendToBack(left)
      canvas.sendToBack(right)
      
      // no locked overlay on cover pages anymore
      
      // Add spine visual block (gray rectangle) on covers only
      const spineX = (leftX + pageW + rightX) / 2
      const spineWidth = Math.max(16, Math.round(pageW * 0.06))
      const spineRect = new fabric.Rect({ left: spineX - spineWidth/2, top: y, width: spineWidth, height: pageH, fill: '#424242', selectable: false, rx:2, ry:2 })
      spineRect.pageMarker = 'cover-spine'
      canvas.add(spineRect)
    } else {
      const left = new fabric.Rect({ left:leftX, top:y, width:pageW, height:pageH, fill:pageFill, stroke:pageStroke, strokeWidth:1, selectable:false, rx:6, ry:6 })
      left.pageMarker = 'left'
      const right = new fabric.Rect({ left:rightX, top:y, width:pageW, height:pageH, fill:pageFill, stroke:pageStroke, strokeWidth:1, selectable:false, rx:6, ry:6 })
      right.pageMarker = 'right'
      canvas.add(left)
      canvas.add(right)
      canvas.sendToBack(left);
      canvas.sendToBack(right);
      // If this is the first content spread (index 1), mark left page visually as locked (dark fill)
      if(cs === 1){
        // set the left page fill to the locked color and mark it locked for logic elsewhere
        try{ left.set('fill', '#424242'); left.isLocked = true }catch(e){}
        // informational label centered on the locked page (non-interactive)
        const lockLabel = new fabric.Text('Эту страницу нельзя редактировать', { left: leftX + pageW/2, top: y + pageH/2, originX: 'center', originY: 'center', fontSize: Math.max(12, Math.round(pageW*0.06)), fill: '#ffffff', selectable:false, evented:false })
        lockLabel.pageMarker = 'locked-left-label'
        lockLabel.pageLabel = true
        canvas.add(lockLabel)
      }
      // Add content page labels on desktop
      if(isDesktop){
        // Special numbering: cs===1 has only 1 page (right, page 1), cs===2+ has 2 pages each, last spread has 1 page
        const spreadCount = Math.floor((totalPages - 2) / 2)
        const isLastSpread = (cs === spreadCount)
        let pageLeftNum, pageRightNum
        
        if(cs === 1){
          // First spread: only right page, numbered as page 1
          pageLeftNum = null
          pageRightNum = 1
        } else if(isLastSpread){
          // Last spread: only right page with its number
          pageLeftNum = null
          pageRightNum = cs * 2
        } else {
          // Middle spreads: both pages (cs 2, 3, 4... → pages 2-3, 4-5, 6-7...)
          pageLeftNum = cs * 2 - 1
          pageRightNum = cs * 2
        }
        
        // Only add label if page exists
        if(pageLeftNum !== null){
          const labelL = new fabric.Text(`Стр. ${pageLeftNum}`, { left: leftX + pageW/2, top: y - 24, fontSize: 12, fill: theme === 'dark' ? '#999' : '#aaa', textAlign: 'center', originX: 'center', selectable: false })
          labelL.pageLabel = true
          canvas.add(labelL)
        }
        if(pageRightNum !== null){
          const labelR = new fabric.Text(`Стр. ${pageRightNum}`, { left: rightX + pageW/2, top: y - 24, fontSize: 12, fill: theme === 'dark' ? '#999' : '#aaa', textAlign: 'center', originX: 'center', selectable: false })
          labelR.pageLabel = true
          canvas.add(labelR)
        }
      }
    }

    // page rects already added above per branch
  }

  // add image file to the selected page
  async function handleFile(e){
    // If this spread has a locked left page (spread 1), we will always add new objects to the right page
    
    const f = e.target.files && e.target.files[0]
    if(!f) return
    const reader = new FileReader()
    reader.onload = async (ev)=>{
      // store blob in indexeddb and create blob url
      const dataUrl = ev.target.result
      // convert dataURL -> blob
      const res = await fetch(dataUrl); const blob = await res.blob();
      const key = 'img_' + Date.now()
      try{ await saveBlob(key, blob); }catch(err){ console.warn('saveBlob failed', err); }
      const blobUrl = URL.createObjectURL(blob)
      fabric.Image.fromURL(blobUrl, img=>{
        const canvas = fabricRef.current
        if(!canvas) return
        // Default position: center of right page if left is locked, otherwise center canvas
        let targetLeft = canvas.getWidth()/2 - (img.width*0.5)/2
        let targetTop = canvas.getHeight()/2 - (img.height*0.5)/2
        if(currentSpread === 1){
          const rightPage = canvas.getObjects().find(o=>o.pageMarker === 'right')
          if(rightPage){ targetLeft = rightPage.left + rightPage.width/2 - (img.width*0.5)/2; targetTop = rightPage.top + rightPage.height/2 - (img.height*0.5)/2 }
        }
        img.set({ left: targetLeft, top: targetTop, scaleX:0.5, scaleY:0.5, hasControls:true })
        img.setControlsVisibility({ mt:true, mb:true, ml:true, mr:true, tl:true, tr:true, bl:true, br:true, mtr:true })
        img._storeKey = key
        img._id = 'obj_' + Date.now()
        canvas.add(img)
        canvas.setActiveObject(img)
        canvas.renderAll()
        // push history and update layers
        try{ undoStack.current.push(canvas.toJSON(['pageMarker','_id','_storeKey'])); }catch(e){}
        refreshObjectsList()
      }, { crossOrigin: 'anonymous' })
    }
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  function addText(){
    const canvas = fabricRef.current
    if(!canvas) return
    // position text on right page for spread 1 (locked left)
    let posLeft = canvas.getWidth()/2 - 100
    let posTop = canvas.getHeight()/2 - 10
    if(currentSpread === 1){ const rightPage = canvas.getObjects().find(o=>o.pageMarker === 'right'); if(rightPage){ posLeft = rightPage.left + 24; posTop = rightPage.top + 24 } }
    const it = new fabric.IText('Текст', { left: posLeft, top: posTop, fontSize: 28, fill: theme === 'dark' ? '#fff' : '#111' })
    canvas.add(it)
    canvas.setActiveObject(it)
    it._id = 'obj_' + Date.now()
    try{ undoStack.current.push(canvas.toJSON(['pageMarker','_id','_storeKey'])); }catch(e){}
    refreshObjectsList()
  }

  function clearCanvas(){
    const canvas = fabricRef.current
    if(!canvas) return
    // remove only objects that are not page markers
    canvas.getObjects().forEach(o=>{ if(!o.pageMarker) canvas.remove(o) })
    try{ undoStack.current.push(canvas.toJSON(['pageMarker','_id','_storeKey'])); }catch(e){}
    canvas.renderAll()
    refreshObjectsList()
  }

  function deleteSelectedObject(){
    const canvas = fabricRef.current
    if(!canvas) return
    const activeObj = canvas.getActiveObject()
    if(!activeObj || activeObj.pageMarker) return
    canvas.remove(activeObj)
    try{ undoStack.current.push(canvas.toJSON(['pageMarker','_id','_storeKey'])); }catch(e){}
    canvas.renderAll()
    refreshObjectsList()
  }

  function exportPNG(){
    // deprecated: exportPNG replaced by saveSpread
    alert('Сохранение разворота выполняется через кнопку "Сохранить разворот" в панели действий')
  }

  // Save current spread into IndexedDB and register metadata
  async function saveSpread(silent){
    const canvas = fabricRef.current; if(!canvas) return
    // collect objects excluding page markers
    const objs = canvas.getObjects().filter(o=>!o.pageMarker).map(o=>{
      // ensure clipPath is serialized
      return o.toObject(['_id','_storeKey','clipPath'])
    })
    // pages: two cover pages [1,2] when currentSpread===0; content spreads start at page 3
    const pages = currentSpread === 0 ? [1,2] : [3 + (currentSpread-1)*2, 4 + (currentSpread-1)*2]
    const payload = { spread: currentSpread, pages, ts: Date.now(), objects: objs }
    const key = `spread_${currentSpread}`
    try{
      await saveSpreadJson(key, JSON.stringify(payload))
      // update metadata list in localStorage
      const metaRaw = localStorage.getItem('savedSpreadsMeta')
      const meta = metaRaw ? JSON.parse(metaRaw) : {}
      // store latest id for this spread (overwrite)
      meta[key] = { key, spread: currentSpread, pages, ts: payload.ts }
      localStorage.setItem('savedSpreadsMeta', JSON.stringify(meta))
      // convert to array for UI if needed
      setSavedSpreads(Object.values(meta))
      if(!silent) alert('Разворот сохранён')
    }catch(err){ console.error('saveSpread failed', err); alert('Ошибка сохранения') }
  }

  // Load saved spread into canvas (clears current non-page objects)
  async function loadSavedSpread(id){
    const canvas = fabricRef.current; if(!canvas) return
    const raw = await getSpreadJson(id)
    if(!raw) return alert('Данные не найдены')
    const data = JSON.parse(raw)
    // remove non-page objects
    canvas.getObjects().forEach(o=>{ if(!o.pageMarker) canvas.remove(o) })
    // enliven objects
    fabric.util.enlivenObjects(data.objects, function(enlivened){
      enlivened.forEach(o=>{ canvas.add(o); assignClipToObject(o) })
      canvas.renderAll(); refreshObjectsList()
    })
  }

  // load spread by index (auto) — returns true if loaded
  async function loadSpreadByIndex(idx){
    const key = `spread_${idx}`
    const raw = await getSpreadJson(key)
    const canvas = fabricRef.current; if(!canvas) return false
    // clear current non-page objects
    canvas.getObjects().forEach(o=>{ if(!o.pageMarker) canvas.remove(o) })
    if(!raw) return false
    const data = JSON.parse(raw)
    fabric.util.enlivenObjects(data.objects, function(enlivened){
      enlivened.forEach(o=>{ canvas.add(o); assignClipToObject(o) })
      canvas.renderAll(); refreshObjectsList()
    })
    return true
  }


  // HISTORY: undo/redo
  function pushState(){
    const canvas = fabricRef.current
    if(!canvas) return
    try{
      const json = canvas.toJSON(['pageMarker','_id','_storeKey'])
      undoStack.current.push(json)
      if(undoStack.current.length > 50) undoStack.current.shift()
      redoStack.current = []
    }catch(e){ console.warn('pushState failed', e) }
  }
  function applyState(json){
    const canvas = fabricRef.current; if(!canvas) return
    canvas.loadFromJSON(json, ()=>{ canvas.renderAll(); refreshObjectsList() })
  }
  // undo/redo removed per user request

  function refreshObjectsList(){
    const canvas = fabricRef.current; if(!canvas) return
    // Build list in top-to-bottom stacking order (top last)
    // Filter out page markers and label text objects (z-index labels, page labels, locked-left-label)
    // Also filter to show only objects that are within visible page bounds
    const pages = canvas.getObjects('rect').filter(r=>r.pageMarker && (r.pageMarker === 'left' || r.pageMarker === 'right' || r.pageMarker === 'cover-left' || r.pageMarker === 'cover-right'))
    const objs = canvas.getObjects().filter(o=>{
      if(o.pageMarker || o.pageLabel) return false
      // check if object is within bounds of any visible page
      const aabb = o.getBoundingRect(true)
      const cx = aabb.left + aabb.width/2
      return pages.some(p=> cx >= p.left && cx <= p.left + p.width)
    })
    const items = objs.map((o, idx)=>({ id: o._id || o.__uid || String(Math.random()), type: o.type, name: o.type, visible: o.visible !== false, z: idx }))
    setObjectsList(items)
  }

  // constrain object inside page bounds when moving/scaling
  function constrainToPage(obj){
    const canvas = fabricRef.current; if(!canvas || !obj) return
    const pages = canvas.getObjects('rect').filter(r=>r.pageMarker)
    if(pages.length===0) return
    const aabb = obj.getBoundingRect(true)
    const cx = aabb.left + aabb.width/2
    let page = pages.find(p=> cx >= p.left && cx <= p.left + p.width)
    // If the left page is locked visually, avoid snapping objects into it; prefer right page
    const hasLockedLeft = !!canvas.getObjects().find(o=> o.pageMarker === 'locked-left' || (o.pageMarker === 'left' && o.isLocked))
    if(page && page.pageMarker === 'left' && hasLockedLeft){ const rightPage = pages.find(p=>p.pageMarker === 'right'); if(rightPage) page = rightPage }
    if(!page) page = pages[0]
    const minLeft = page.left; const minTop = page.top; const maxLeft = page.left + page.width - aabb.width; const maxTop = page.top + page.height - aabb.height
    const newLeft = Math.min(Math.max(aabb.left, minLeft), Math.max(minLeft, maxLeft))
    const newTop = Math.min(Math.max(aabb.top, minTop), Math.max(minTop, maxTop))
    obj.set({ left: newLeft, top: newTop })
    obj.setCoords()
  }

  // Assign clipPath to object so it is visually cropped to its page bounds
  function assignClipToObject(obj){
    const canvas = fabricRef.current; if(!canvas || !obj) return
    // find page rects
    const pages = canvas.getObjects('rect').filter(r=>r.pageMarker)
    if(pages.length === 0){ obj.clipPath = null; return }
    const aabb = obj.getBoundingRect(true)
    const cx = aabb.left + aabb.width/2
    let page = pages.find(p=> cx >= p.left && cx <= p.left + p.width)
    const hasLockedLeft = !!canvas.getObjects().find(o=> o.pageMarker === 'locked-left' || (o.pageMarker === 'left' && o.isLocked))
    if(page && page.pageMarker === 'left' && hasLockedLeft){ const rightPage = pages.find(p=>p.pageMarker === 'right'); if(rightPage) page = rightPage }
    if(!page){ page = pages[0] }
    // create a clip rect positioned in canvas coordinates
    const clip = new fabric.Rect({ left: page.left, top: page.top, width: page.width, height: page.height, absolutePositioned: true })
    // set clipPath (fabric will clone/serialize it)
    obj.clipPath = clip
    // ensure clipPath is not selectable
    if(obj.clipPath) obj.clipPath.selectable = false
  }

  // Layer reordering: move object to new z-index
  function moveObjectToIndex(objId, newIndex){
    const canvas = fabricRef.current; if(!canvas) return
    const obj = canvas.getObjects().find(o=>o._id === objId || o.__uid === objId)
    if(!obj) return
    // compute insertion index relative to canvas._objects: skip page markers
    const pageCount = canvas.getObjects().filter(o=>o.pageMarker).length
    const maxNonPage = Math.max(0, canvas.getObjects().length - pageCount - 1)
    const clamped = Math.max(0, Math.min(newIndex, maxNonPage))
    const targetIndex = pageCount + clamped
    // remove and insert at target index
    canvas.remove(obj)
    canvas.insertAt(obj, targetIndex)
    canvas.renderAll(); refreshObjectsList()
  }

  // navigation between spreads
  async function reorderSpreads(fromIdx, toIdx){
    // Protect cover (0) and first content spread (1) from being moved
    if(typeof fromIdx !== 'number' || typeof toIdx !== 'number') return
    if(fromIdx === toIdx) return
    if(fromIdx <= 1 || toIdx <= 1){ console.warn('Attempt to reorder protected spreads ignored'); return }

    try{
      // load saved meta map
      const metaRaw = localStorage.getItem('savedSpreadsMeta')
      const meta = metaRaw ? JSON.parse(metaRaw) : {}
      const spreadCount = Math.floor((totalPages - 2) / 2)

      // build ordered array of objects {idx, key, raw, metaEntry}
      const arr = []
      for(let i = 1; i <= spreadCount; i++){
        const key = `spread_${i}`
        // load raw JSON (may be null)
        // use getSpreadJson which returns a promise
        arr.push({ idx: i, key })
      }

      // fetch all raw data in parallel
      const raws = await Promise.all(arr.map(a => getSpreadJson(a.key).catch(()=>null)))
      for(let i=0;i<arr.length;i++){
        arr[i].raw = raws[i]
        arr[i].meta = meta[arr[i].key] || null
      }

      // move element from fromIdx to toIdx within arr (both are 1-based indices into content spreads)
      const fromPos = arr.findIndex(x=> x.idx === fromIdx)
      const toPos = arr.findIndex(x=> x.idx === toIdx)
      if(fromPos === -1 || toPos === -1){ console.warn('Invalid spread indices for reorder'); return }
      const [moved] = arr.splice(fromPos, 1)
      arr.splice(toPos, 0, moved)

      // now write back all entries to storage under their new keys (reindex sequentially starting at 1)
      const newMeta = {}
      for(let i=0;i<arr.length;i++){
        const newIdx = i + 1
        const newKey = `spread_${newIdx}`
        const item = arr[i]
        if(item.raw === undefined || item.raw === null){
          await deleteSpreadJson(newKey).catch(()=>null)
          if(item.meta) {
            // update meta if exists but raw missing: delete
            // nothing
          }
        } else {
          await saveSpreadJson(newKey, item.raw).catch((e)=>{ console.warn('saveSpreadJson failed', e) })
        }
        if(item.meta){
          item.meta.spread = newIdx
          newMeta[newKey] = item.meta
        }
      }

      // remove any leftover keys beyond new length (previously larger)
      for(let i = arr.length + 1; i <= spreadCount; i++){
        const extraKey = `spread_${i}`
        await deleteSpreadJson(extraKey).catch(()=>null)
        if(newMeta[extraKey]) delete newMeta[extraKey]
      }

      // persist updated meta map
      localStorage.setItem('savedSpreadsMeta', JSON.stringify(newMeta))
      setSavedSpreads(Object.values(newMeta))

      // update currentSpread mapping: if user was on moved spread, map to its new index
      if(currentSpread === fromIdx) setCurrentSpread(toIdx)
      else if(currentSpread === toIdx) setCurrentSpread(fromIdx)

      // navigate to the target spread
      await gotoSpread(toIdx)
    }catch(e){ console.error('reorderSpreads failed', e); alert('Ошибка при перестановке разворотов') }
  }

  // Add a new spread (2 pages). Max spreads count is 35 (=> max pages = 70)
  function addSpread(){
    const currentSpreads = Math.floor(totalPages / 2)
    if(currentSpreads >= 35){ alert('Достигнут максимум разворотов (35)'); return }
    const newTotal = Math.min(70, totalPages + 2)
    setTotalPages(newTotal)
    // mark the newly added spread for a short highlight in thumbnails
    const newSpreadIdx = Math.floor((newTotal - 2) / 2)
    setJustAddedSpread(newSpreadIdx)
    setTimeout(()=> setJustAddedSpread(null), 900)
  }

  function zoomIn(){ setZoom(z=>Math.min(2, +(z+0.1).toFixed(2))) }
  function zoomOut(){ setZoom(z=>Math.max(0.5, +(z-0.1).toFixed(2))) }
  function zoomReset(){ setZoom(1) }

  async function gotoSpread(idx){
    if(typeof idx !== 'number') return
    // compute number of content spreads based on totalPages (exclude covers)
    const spreadCount = Math.floor((totalPages - 2) / 2)
    const clamped = Math.max(0, Math.min(idx, spreadCount))
    const canvas = fabricRef.current; if(!canvas) return
    // save current spread before navigating away
    try{ await saveSpread(true) }catch(e){ console.warn('save before nav failed', e) }
    // small delay to ensure save completes before loading
    await new Promise(r=>setTimeout(r, 100))
    setCurrentSpread(clamped)
    // re-render pages for new spread (pass override so render uses updated spread immediately)
    renderPages(canvas, canvas.getWidth(), canvas.getHeight(), theme, clamped)
    // try to auto-load saved spread for this index; if none, clear non-page objects
    const found = await loadSpreadByIndex(clamped)
    if(!found){ canvas.getObjects().forEach(o=>{ if(!o.pageMarker) canvas.remove(o) }); canvas.renderAll(); refreshObjectsList() }
    canvas.renderAll()
  }

  // load saved metadata from localStorage on mount
  useEffect(()=>{
    const raw = localStorage.getItem('savedSpreadsMeta')
    if(raw) try{ const parsed = JSON.parse(raw); setSavedSpreads(Array.isArray(parsed) ? parsed : Object.values(parsed)); }catch(e){}
  }, [])

  // Ensure last two pages (31-32) are removed: set totalPages to 30 and delete corresponding spread if present
  useEffect(()=>{
    // On mount: remove any saved spread_15 (pages 31-32) from storage if present
    const lastSpreadKey = 'spread_15'
    ;(async ()=>{
      try{ await deleteSpreadJson(lastSpreadKey) }catch(e){}
      try{
        const metaRaw = localStorage.getItem('savedSpreadsMeta')
        if(metaRaw){
          const meta = JSON.parse(metaRaw)
          if(meta && meta[lastSpreadKey]){ delete meta[lastSpreadKey]; localStorage.setItem('savedSpreadsMeta', JSON.stringify(meta)); setSavedSpreads(Object.values(meta)) }
        }
      }catch(e){}
    })()
  }, [])

  // schedule autosave with debounce
  function scheduleAutoSave(){
    if(autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(()=>{
      saveSpread(true)
    }, autosaveDelay)
  }

  // Color panel handlers
  const toggleColorPanel = ()=> setColorPanelOpen(v=>!v)
  const applySelectedColor = ()=>{
    const c = fabricRef.current; if(!c) return; const o = c.getActiveObject(); if(!o) return; const col = selectedColor
    if(o.type === 'i-text' || o.type === 'textbox' || o.type === 'text'){
      o.set('fill', col); c.requestRenderAll(); pushState();
    } else alert('Выберите текстовый объект')
  }

  return (
    <div className={`editor-root ${theme}`}>

      <div className={`editor-sidepanel`}>
        {/* EDITABLE: background color of this side panel is controlled by --sidepanel-bg CSS variable */}
        <div className="panel-block">
          <h4>Действия</h4>
          <label className="btn">Добавить фото<input type="file" accept="image/*" onChange={handleFile} style={{display:'none'}}/></label>
          <button className="btn" onClick={addText}>Добавить текст</button>
          <button className="btn" onClick={deleteSelectedObject}>Удалить слой</button>
          <button className="btn" onClick={clearCanvas}>Очистить</button>
          <button className="btn primary" onClick={()=>saveSpread(false)}>Сохранить разворот</button>
        </div>

        <div className="panel-block">
          <h4>Цвет текста</h4>
          <button className="btn" onClick={()=>{ setColorPanelOpen(v=>!v); if(isMobile && !colorPanelOpen) setPagesPanelOpen(false) }}>{colorPanelOpen ? 'Закрыть' : 'Выбрать цвет'}</button>
          {colorPanelOpen && isMobile && <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:100}} onClick={()=>setColorPanelOpen(false)} />}
          <div className={`color-panel ${colorPanelOpen ? 'open' : ''} ${isMobile ? 'mobile' : ''}`}>
            <div className="swatches">
              {/* EDITABLE: Измените цвета в этом массиве на нужные вам. Формат: '#RRGGBB' */}
              {['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffcc00','#ff66aa','#33ccff'].map(c=> (
                <button key={c} className="swatch" style={{background:c, border: c === selectedColor ? '2px solid #222' : '1px solid rgba(0,0,0,0.12)'}} onClick={()=>setSelectedColor(c)} />
              ))}
            </div>
            <div style={{marginTop:8}}>
              <input type="color" value={selectedColor} onChange={(e)=>setSelectedColor(e.target.value)} />
              <button className="btn" style={{marginLeft:8}} onClick={applySelectedColor}>Применить</button>
            </div>
          </div>
        </div>

        <div className="panel-block">
          <h4>Масштаб</h4>
          <div style={{display:'flex',gap:8,alignItems:'center', marginTop:6}}>
            <button className="btn" onClick={zoomOut}>−</button>
            <div style={{minWidth:64, textAlign:'center'}}>{(zoom||1).toFixed(2)}×</div>
            <button className="btn" onClick={zoomIn}>+</button>
          </div>
          <div style={{marginTop:8}}>
            <input type="range" min={0.5} max={2} step={0.05} value={zoom} onChange={(e)=>setZoom(Number(e.target.value))} style={{width:'100%'}} />
            <div style={{display:'flex',justifyContent:'space-between',marginTop:6}}>
              <button className="btn" onClick={zoomReset}>Сброс</button>
              <button className="btn" onClick={()=>setZoom(1.25)}>1.25×</button>
            </div>
          </div>
        </div>

        <div className="panel-block">
          <h4 style={{cursor:'pointer'}} onClick={()=>{ /* toggle expand */ const el = document.querySelector('.layers'); if(el) el.classList.toggle('open') }}>Слои (нажмите для раскрытия)</h4>
          <div className="layers">
            {objectsList.map((o, idx)=> (
              <div key={o.id} className="layer-item" draggable onDragStart={(ev)=>{ ev.dataTransfer.setData('text/plain', o.id); ev.currentTarget.classList.add('dragging') }} onDragEnd={(ev)=>{ ev.currentTarget.classList.remove('dragging') }} onDragOver={(ev)=>{ ev.preventDefault(); ev.currentTarget.classList.add('dragover') }} onDragLeave={(ev)=>{ ev.currentTarget.classList.remove('dragover') }} onDrop={(ev)=>{ ev.preventDefault(); ev.currentTarget.classList.remove('dragover'); const dragged = ev.dataTransfer.getData('text/plain'); const targetIdx = objectsList.findIndex(x=>x.id===o.id); moveObjectToIndex(dragged, targetIdx); }}>
                <div style={{flex:1}}>{o.name} <div style={{fontSize:11,color:'var(--muted)'}}>z:{o.z}</div></div>
                <div style={{display:'flex',gap:6}}>
                  <button className="btn" onClick={()=>{ const c = fabricRef.current; if(!c) return; const obj = c.getObjects().find(x=>x._id===o.id); if(!obj) return; c.setActiveObject(obj); c.renderAll(); }}>select</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Панель 'Страницы' удалена по запросу пользователя */}
      </div>

      <div className="canvas-wrapper" style={{position:'relative', flex:1}}>
        <canvas ref={canvasRef} id="fabric-canvas" style={{display:'block', width:'100%', height:'100%'}} />

        {currentSpread === 0 && (
          <div key="cover-labels" style={{
            position: 'absolute',
            top: 20,
            left: '6%',
            right: '6%',
            zIndex: 50,
            display: 'flex',
            justifyContent: 'space-between',
            pointerEvents: 'none',
            fontSize: '13px',
            color: '#666'
          }}>
            <div style={{textAlign: 'center'}}>задняя обложка</div>
            <div style={{textAlign: 'center'}}>лицевая обложка</div>
          </div>
        )}
      </div>

      {/* Перенесённый блок с информацией о текущем развороте (над панелью превью) */}
      <div className="bottom-info">Текущий разворот: {currentSpread} — страницы: {currentSpread===0? 'обложки' : `${3 + (currentSpread-1)*2}-${4 + (currentSpread-1)*2}`}</div>

      {/* Панель превью разворотов (горизонтальная, по всему низу) - отображается на всех устройствах */}
      <div className="thumbnails-panel">
        <div className="thumbnails-header" style={{position:'relative'}}>
          <h4 style={{margin:0}}>Разворты</h4>
          <div style={{position:'absolute', left:'50%', transform:'translateX(-50%)', textAlign:'center', fontSize:'0.9rem', color:'var(--muted)'}}>
            {currentSpread===0 ? 'обложка' : (() => {
              const spreadCount = Math.floor((totalPages - 2) / 2)
              const isLastSpread = (currentSpread === spreadCount)
              if(currentSpread === 1) return 'стр: 1'
              if(isLastSpread) return `стр: ${currentSpread * 2}`
              return `стр: ${currentSpread * 2 - 1}-${currentSpread * 2}`
            })()}
          </div>
          <div className="thumbnails-controls">
            <button className="btn" onClick={()=>gotoSpread(currentSpread-1)}>← Пред.</button>
            <div style={{width: '120px'}}></div>
            <button className="btn" onClick={()=>gotoSpread(currentSpread+1)}>След. →</button>
          </div>
        </div>

        <div className="thumbnails-container">
            {/* Cover spread */}
            <div
              className={`thumbnail-item ${currentSpread === 0 ? 'active' : ''}`}
              onClick={() => gotoSpread(0)}
              draggable={false}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over') }}
              onDragLeave={(e) => { e.currentTarget.classList.remove('drag-over') }}
              onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const sourceIdx = Number(e.dataTransfer.getData('spreadIndex')); if(sourceIdx > 1) reorderSpreads(sourceIdx, 0) }}
            >
              <div className="thumbnail-preview">
                <div className="thumb-cover-marker">Обложка</div>
              </div>
              <div className="thumbnail-label">&nbsp;</div>
            </div>

            {/* Content spreads */}
            {Array.from({ length: (totalPages - 2) / 2 }).map((_, i) => {
              const spreadIdx = i + 1
              const spreadCount = Math.floor((totalPages - 2) / 2)
              const isLastSpread = (spreadIdx === spreadCount)
              // Display numbering with special cases for first and last spread
              let pageDisplayStr = ''
              if(spreadIdx === 1) {
                pageDisplayStr = 'стр. 1'
              } else if(isLastSpread) {
                pageDisplayStr = `стр. ${spreadIdx * 2}`
              } else {
                pageDisplayStr = `стр. ${spreadIdx * 2 - 1}–${spreadIdx * 2}`
              }
              return (
                <div
                  key={spreadIdx}
                  className={`thumbnail-item ${currentSpread === spreadIdx ? 'active' : ''} ${justAddedSpread === spreadIdx ? 'flash' : ''}`}
                  onClick={() => gotoSpread(spreadIdx)}
                  draggable={spreadIdx > 1}
                  onDragStart={(e) => { if(spreadIdx > 1){ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('spreadIndex', String(spreadIdx)) } }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over') }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove('drag-over') }}
                  onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const sourceIdx = Number(e.dataTransfer.getData('spreadIndex')); if(sourceIdx > 1 && spreadIdx > 1 && sourceIdx !== spreadIdx) reorderSpreads(sourceIdx, spreadIdx) }}
                >
                  <div className="thumbnail-preview">
                    <div className="thumb-preview-content">
                      <div style={{fontSize: '10px', textAlign: 'center', color: '#999'}}>{pageDisplayStr}</div>
                    </div>
                  </div>
                  <div className="thumbnail-label">Разворот {spreadIdx}</div>
                </div>
              )
            })}
            {/* Add button placed inline with thumbnails: large, no background */}
            <div className={`thumbnail-item thumbnail-add`} onClick={addSpread} title="Добавить разворот" style={{cursor:'pointer'}}>
              <div className="thumbnail-preview" style={{background:'transparent', boxShadow:'none', border:'none', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <div style={{fontSize:32, lineHeight:1, color:'#333'}}>+</div>
              </div>
              <div className="thumbnail-label">&nbsp;</div>
            </div>
          </div>
      </div>
    </div>
  )
}
