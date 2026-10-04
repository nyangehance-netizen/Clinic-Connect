// Prepares the Android app before Capacitor builds it.
//
// With APP_URL set (your hosted server, https://...), the app opens that server,
// so everyone shares the same data and web updates reach phones instantly.
// Without APP_URL, the app is built in preview mode: the full web app is bundled
// inside the APK and keeps its data on the phone, so it works with no hosting.
import { writeFileSync, rmSync, mkdirSync, cpSync, readdirSync } from 'node:fs';

const url = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
const config = {
  appId: 'com.clinicconnect.app',
  appName: 'Clinic Connect',
  webDir: 'www',
  android: { backgroundColor: '#F3F6F5' }
};

// Rebuild www from the shared web app so both modes have the same screens.
for (const f of readdirSync('www')) if (f !== 'offline.html') rmSync(`www/${f}`, { recursive: true, force: true });
mkdirSync('www', { recursive: true });
cpSync('../public', 'www', { recursive: true });
rmSync('www/sw.js', { force: true });

if (url) {
  if (!/^https:\/\/[^\s/]+/.test(url)) {
    console.error(`APP_URL must start with https://. Got: "${url}"`);
    process.exit(1);
  }
  config.server = { url, cleartext: false, errorPath: 'offline.html' };
  console.log(`Live mode: the app opens ${url}`);
} else {
  writeFileSync('www/config.js', '// Built without APP_URL: preview mode, data stays on the phone.\nwindow.CC_PREVIEW = true;\n');
  console.log('Preview mode: no APP_URL set, so the app runs on its own with data kept on the phone.');
}

writeFileSync('capacitor.config.json', JSON.stringify(config, null, 2) + '\n');
