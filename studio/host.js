/* Lets audio/album/planner.js run inside the Studio Board. planner.js reads window.PLANNER_HOST once at load,
   before app.js exists, so every hook here falls back to the planner's own behaviour until StudioApp is ready. */
window.PLANNER_HOST = {
  plannerVisible:() => window.StudioApp ? window.StudioApp.plannerVisible() : true,
  cardRoot:() => document.getElementById("page"),
  navigated:nav => window.StudioApp?.plannerNavigated(nav),
  detailsHref:stem => "./?t=" + encodeURIComponent(stem),
  lyricHref:stem => "./?t=" + encodeURIComponent(stem) + "#lyrics",
  panelVisible:() => true,
  keysActive:view => window.StudioApp ? window.StudioApp.keysActive(view) : false,
  rendered:() => window.StudioApp?.plannerRendered(),
};
