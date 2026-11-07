// The "Send to Precedents" bookmark button. Runs on any web page: collects the highlighted text, the page details
// and the biggest images, and opens the small capture window with them. Same idea as Groundwork's bookmarklet.
export function bookmarklet(origin) {
  const code = `(()=>{const g=n=>{const e=document.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]');return e?e.content:''};`
    + `const sel=getSelection();const t=String(sel||'').trim().slice(0,15000);let im=[];`
    + `try{if(sel.rangeCount){sel.getRangeAt(0).cloneContents().querySelectorAll('img').forEach(i=>{const s=i.getAttribute('src');if(s)im.push(new URL(s,location.href).href)})}}catch(e){}`
    + `const og=g('og:image');if(og)try{im.push(new URL(og,location.href).href)}catch(e){}`
    + `[...document.images].filter(i=>i.naturalWidth>=400&&i.naturalHeight>=260).sort((a,b)=>b.naturalWidth*b.naturalHeight-a.naturalWidth*a.naturalHeight).slice(0,10).forEach(i=>im.push(i.currentSrc||i.src));`
    + `im=[...new Set(im)].filter(u=>/^https?:/.test(u)).slice(0,12);`
    + `const d={url:location.href,title:document.title,site:g('og:site_name'),author:g('author')||g('article:author'),date:g('article:published_time'),text:t,images:im};`
    + `window.open('${origin}/capture.html#'+encodeURIComponent(JSON.stringify(d)),'precedents','width=560,height=780')})()`;
  return "javascript:" + encodeURIComponent(code);
}
