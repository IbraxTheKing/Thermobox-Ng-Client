#!/usr/bin/env node
/*
 * Android app (Capacitor):
 *
 *   node scripts/android.mjs prepare
 *     To run once after "npx cap add android" (then to commit with android/), and safely at each
 *     build (nothing is changed twice):
 *     - versionName / versionCode read from the Gradle properties thermoboxVersionName /
 *       thermoboxVersionCode (else "dev" / 1);
 *     - signing of the release build with the properties thermoboxKeystore,
 *       thermoboxKeystorePassword, thermoboxKeyAlias, thermoboxKeyPassword (the key is never in
 *       the repository);
 *     - *.jks and *.keystore ignored by Git.
 *
 *   node scripts/android.mjs version
 *     Prints "name=…" and "code=…" for the current version (scripts/version.mjs), to give to
 *     Gradle: ./gradlew assembleRelease -PthermoboxVersionName=… -PthermoboxVersionCode=…
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { androidVersionCode, clientVersion } from './version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '// thermobox:';

function prepare() {
  const gradle = join(root, 'android', 'app', 'build.gradle');
  if (!existsSync(gradle)) {
    console.error('android/app/build.gradle not found: run "npx cap add android" first.');
    process.exit(1);
  }
  let s = readFileSync(gradle, 'utf8');
  const before = s;

  if (!s.includes(`${MARK}version`)) {
    s = s
      .replace(/^(\s*)versionCode\s+\d+\s*$/m, `$1${MARK}version — Gradle properties given by the workflows (scripts/android.mjs version)\n$1versionCode((project.findProperty('thermoboxVersionCode') ?: '1') as int)`)
      .replace(/^(\s*)versionName\s+"[^"]*"\s*$/m, `$1versionName((project.findProperty('thermoboxVersionName') ?: 'dev') as String)`);
    if (!s.includes(`${MARK}version`)) throw new Error('versionCode / versionName not found in android/app/build.gradle');
  }

  if (!s.includes(`${MARK}signature`)) {
    const signature = `    ${MARK}signature — key given by -PthermoboxKeystore=… (never in the repository)
    signingConfigs {
        release {
            if (project.hasProperty('thermoboxKeystore')) {
                storeFile file(project.property('thermoboxKeystore'))
                storePassword project.property('thermoboxKeystorePassword')
                keyAlias project.property('thermoboxKeyAlias')
                keyPassword project.property('thermoboxKeyPassword')
            }
        }
    }
`;
    const i = s.search(/^\s*buildTypes\s*\{/m);
    if (i < 0) throw new Error('buildTypes not found in android/app/build.gradle');
    // The release build type (after buildTypes {), signed when a key is given
    const types = s.slice(i).replace(/^(\s*)release\s*\{\s*\n/m, (m, indent) => `${m}${indent}    ${MARK}signature-release\n${indent}    if (project.hasProperty('thermoboxKeystore')) signingConfig = signingConfigs.release\n`);
    s = s.slice(0, i) + signature + types;
    if (!s.includes(`${MARK}signature-release`)) throw new Error('buildTypes.release not found in android/app/build.gradle');
  }

  if (s !== before) {
    writeFileSync(gradle, s);
    console.log('android/app/build.gradle: version and signing ready');
  } else {
    console.log('android/app/build.gradle: already ready');
  }

  const ignore = join(root, 'android', '.gitignore');
  if (existsSync(ignore)) {
    const g = readFileSync(ignore, 'utf8');
    const g2 = g.replace(/^#\s*\*\.jks\s*$/m, '*.jks').replace(/^#\s*\*\.keystore\s*$/m, '*.keystore');
    const g3 = /^\*\.jks$/m.test(g2) ? g2 : `${g2.trimEnd()}\n\n# Signing keys: never in the repository\n*.jks\n*.keystore\n`;
    if (g3 !== g) {
      writeFileSync(ignore, g3);
      console.log('android/.gitignore: signing keys ignored');
    }
  }
}

function version() {
  const name = clientVersion();
  console.log(`name=${name}`);
  console.log(`code=${androidVersionCode(name)}`);
}

const command = process.argv[2];
if (command === 'prepare') prepare();
else if (command === 'version') version();
else {
  console.error('Usage: node scripts/android.mjs prepare | version');
  process.exit(1);
}
