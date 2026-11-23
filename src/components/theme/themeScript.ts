/** Storage key for the visitor's choice: "light" | "dark" | "system" (default). */
export const THEME_KEY = "wt:theme";
export const THEME_EVENT = "wt:theme";

/**
 * Runs in <head> before the page paints, so the page never flashes the wrong theme.
 * Also follows the device setting live while the choice is "system".
 */
export const themeScript = `(function(){
  var k=${JSON.stringify(THEME_KEY)},m=window.matchMedia("(prefers-color-scheme: dark)");
  function pref(){try{var v=localStorage.getItem(k);return v==="light"||v==="dark"?v:"system"}catch(e){return "system"}}
  function apply(){var p=pref(),d=p==="dark"||(p==="system"&&m.matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}
  apply();
  try{m.addEventListener("change",apply)}catch(e){m.addListener&&m.addListener(apply)}
  window.addEventListener(${JSON.stringify(THEME_EVENT)},apply);
  window.addEventListener("storage",function(e){if(e.key===k)apply()});
})();`;
