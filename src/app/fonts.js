// Font CSS and files are optional. One deadline covers their combined load, not each step.
export async function waitForFonts(fonts, stylesheetReady, timeoutMs = 2500) {
  if (!fonts?.load) return;
  let timer;
  const loaded = Promise.resolve(stylesheetReady).then(() => Promise.all([
    fonts.load('600 100px "Inter Tight"'),
    fonts.load('700 100px "Inter Tight"'),
  ])).catch(() => null);
  try {
    await Promise.race([loaded, new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  } finally { clearTimeout(timer); }
}
