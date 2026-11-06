/** Runs before the page paints, so a dark-mode reader never sees a light flash. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("ladder-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;
