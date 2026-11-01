#!/usr/bin/env node
/*
 * Application Android (Capacitor) :
 *
 *   node scripts/android.mjs preparer
 *     À lancer une fois après « npx cap add android » (puis à commiter avec android/), et sans
 *     risque à chaque build (rien n'est modifié deux fois) :
 *     - versionName / versionCode lus dans les propriétés Gradle thermoboxVersionName /
 *       thermoboxVersionCode (sinon « dev » / 1) ;
 *     - signature de la version release par les propriétés thermoboxKeystore,
 *       thermoboxKeystorePassword, thermoboxKeyAlias, thermoboxKeyPassword (la clé n'est jamais
 *       dans le dépôt) ;
 *     - *.jks et *.keystore ignorés par Git.
 *
 *   node scripts/android.mjs version
 *     Affiche « nom=… » et « code=… » pour la version courante (scripts/version.mjs), à passer à
 *     Gradle : ./gradlew assembleRelease -PthermoboxVersionName=… -PthermoboxVersionCode=…
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { versionClient, versionCodeAndroid } from './version.mjs';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARQUE = '// thermobox:';

function preparer() {
  const gradle = join(racine, 'android', 'app', 'build.gradle');
  if (!existsSync(gradle)) {
    console.error('android/app/build.gradle introuvable : lancez d\'abord « npx cap add android ».');
    process.exit(1);
  }
  let s = readFileSync(gradle, 'utf8');
  const avant = s;

  if (!s.includes(`${MARQUE}version`)) {
    s = s
      .replace(/^(\s*)versionCode\s+\d+\s*$/m, `$1${MARQUE}version — propriétés Gradle données par les workflows (scripts/android.mjs version)\n$1versionCode((project.findProperty('thermoboxVersionCode') ?: '1') as int)`)
      .replace(/^(\s*)versionName\s+"[^"]*"\s*$/m, `$1versionName((project.findProperty('thermoboxVersionName') ?: 'dev') as String)`);
    if (!s.includes(`${MARQUE}version`)) throw new Error('versionCode / versionName introuvables dans android/app/build.gradle');
  }

  if (!s.includes(`${MARQUE}signature`)) {
    const signature = `    ${MARQUE}signature — clé donnée par -PthermoboxKeystore=… (jamais dans le dépôt)
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
    if (i < 0) throw new Error('buildTypes introuvable dans android/app/build.gradle');
    // The release build type (after buildTypes {), signed when a key is given
    const types = s.slice(i).replace(/^(\s*)release\s*\{\s*\n/m, (m, indent) => `${m}${indent}    ${MARQUE}signature-release\n${indent}    if (project.hasProperty('thermoboxKeystore')) signingConfig = signingConfigs.release\n`);
    s = s.slice(0, i) + signature + types;
    if (!s.includes(`${MARQUE}signature-release`)) throw new Error('buildTypes.release introuvable dans android/app/build.gradle');
  }

  if (s !== avant) {
    writeFileSync(gradle, s);
    console.log('android/app/build.gradle : version et signature prêtes');
  } else {
    console.log('android/app/build.gradle : déjà prêt');
  }

  const ignore = join(racine, 'android', '.gitignore');
  if (existsSync(ignore)) {
    const g = readFileSync(ignore, 'utf8');
    const g2 = g.replace(/^#\s*\*\.jks\s*$/m, '*.jks').replace(/^#\s*\*\.keystore\s*$/m, '*.keystore');
    const g3 = /^\*\.jks$/m.test(g2) ? g2 : `${g2.trimEnd()}\n\n# Clés de signature : jamais dans le dépôt\n*.jks\n*.keystore\n`;
    if (g3 !== g) {
      writeFileSync(ignore, g3);
      console.log('android/.gitignore : clés de signature ignorées');
    }
  }
}

function version() {
  const nom = versionClient();
  console.log(`nom=${nom}`);
  console.log(`code=${versionCodeAndroid(nom)}`);
}

const commande = process.argv[2];
if (commande === 'preparer') preparer();
else if (commande === 'version') version();
else {
  console.error('Usage : node scripts/android.mjs preparer | version');
  process.exit(1);
}
