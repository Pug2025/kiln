// Kiln QA (G): the device sizes every browser check uses (brief G task 3, PLAN §10).
// CSS pixels, device pixel ratio, touch, and a user agent close to the real device so pages
// that sniff "mobile" behave as on the phone.

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

export const DEVICES = Object.freeze({
  smallphone: { name: 'Small phone viewport', width: 320, height: 568, dpr: 2, mobile: true, touch: true, ua: IOS_UA },
  mobile: { name: 'Phone (built-in browser mobile preset)', width: 375, height: 812, dpr: 3, mobile: true, touch: true, ua: IOS_UA },
  iphone14pro: { name: 'iPhone 14 Pro', width: 390, height: 844, dpr: 3, mobile: true, touch: true, ua: IOS_UA },
  pixel7: { name: 'Pixel 7', width: 412, height: 915, dpr: 2.625, mobile: true, touch: true, ua: ANDROID_UA },
  desktop: { name: 'Desktop', width: 1280, height: 800, dpr: 2, mobile: false, touch: false, ua: '' },
  desktop1440: { name: 'Desktop', width: 1440, height: 900, dpr: 2, mobile: false, touch: false, ua: '' },
});

/** Device names in the order browser checks run them. */
export const CHECK_ORDER = ['mobile', 'iphone14pro', 'pixel7', 'desktop', 'desktop1440'];

export function getDevice(name) {
  const d = DEVICES[name];
  if (!d) throw new Error(`unknown device "${name}" (one of: ${Object.keys(DEVICES).join(', ')})`);
  return { id: name, ...d };
}

/** Apply a device to a CDP page session (lib/cdp.mjs makePage). */
export async function emulateDevice(page, d) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: d.width,
    height: d.height,
    deviceScaleFactor: d.dpr,
    mobile: d.mobile,
    screenWidth: d.width,
    screenHeight: d.height,
  });
  await page.send('Emulation.setTouchEmulationEnabled', d.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  if (d.ua) await page.send('Emulation.setUserAgentOverride', { userAgent: d.ua, platform: d.mobile ? (d.ua.includes('iPhone') ? 'iPhone' : 'Linux armv8l') : '' });
}
