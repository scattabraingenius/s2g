/* Shared review values and plain-text annotation anchors. No lyric text is rewritten. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReviewTools = api;
})(typeof window === 'object' ? window : globalThis, function() {
  'use strict';
  const readiness = [['unassessed','Not assessed'],['ready','Ready'],['heavy','Heavy'],['aside','Set aside']];
  const colors = [['green','Keep / favourite'],['yellow','Revisit'],['red','Rewrite'],['blue','Alternate / idea'],['purple','Emotionally heavy']];
  const tags = ['Great writing','Strong hook','Needs revision','Preferred'];
  const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function fingerprint(text) {
    let hash = 2166136261;
    for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return text.length + ':' + (hash >>> 0).toString(16);
  }
  function valid(mark, text) {
    return mark && colors.some(([c]) => c === mark.color) && Number.isInteger(mark.start) && Number.isInteger(mark.end) && mark.start >= 0 && mark.end > mark.start && mark.end <= text.length && mark.fingerprint === fingerprint(text) && text.slice(mark.start,mark.end) === mark.quote;
  }
  function marks(rating) { return Object.entries(rating || {}).filter(([k,v]) => k.startsWith('mark:') && v).map(([key,mark]) => ({key,...mark})); }
  function html(text, rating) {
    const active = marks(rating).filter(m => valid(m,text));
    let offset=0;
    return text.split('\n').map(line => {
      const start=offset, end=start+line.length; offset=end+1;
      const cuts=[...new Set([start,end,...active.flatMap(m => [Math.max(start,Math.min(end,m.start)),Math.max(start,Math.min(end,m.end))])])].sort((a,b)=>a-b);
      let out='';
      for(let i=0;i<cuts.length-1;i++) {
        const a=cuts[i],b=cuts[i+1], covering=active.filter(m=>m.start<=a && m.end>=b);
        let part=escape(text.slice(a,b));
        for (const m of covering) part=`<mark class="review-mark mark-${m.color}" title="${escape(m.comment || m.color)}">${part}</mark>`;
        out+=part;
      }
      return `<span class="review-line" data-start="${start}" data-end="${end}">${out}</span>`;
    }).join('\n');
  }
  function options(value='unassessed') { return readiness.map(([key,label])=>`<option value="${key}" ${key===value?'selected':''}>${label}</option>`).join(''); }
  return {readiness,colors,tags,escape,fingerprint,valid,marks,html,options};
});
