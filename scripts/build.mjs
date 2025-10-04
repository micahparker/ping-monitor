#!/usr/bin/env node
import {promises as fs} from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {spawn} from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function copyFile(relativePath, destinationRoot) {
    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(destinationRoot, relativePath);

    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    await fs.copyFile(sourcePath, targetPath);
}

async function copyDirectory(relativePath, destinationRoot) {
    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(destinationRoot, relativePath);

    await fs.mkdir(targetPath, {recursive: true});
    const entries = await fs.readdir(sourcePath, {withFileTypes: true});

    for (const entry of entries) {
        const entryRelativePath = path.join(relativePath, entry.name);
        if (entry.isDirectory()) {
            await copyDirectory(entryRelativePath, destinationRoot);
        } else if (entry.isFile()) {
            await copyFile(entryRelativePath, destinationRoot);
        }
    }
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            ...options,
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
            }
        });

        child.on('error', reject);
    });
}

async function main() {
    const metadataPath = path.join(repoRoot, 'metadata.json');
    const metadataRaw = await fs.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(metadataRaw);

    const uuid = metadata.uuid;
    if (!uuid) {
        throw new Error('metadata.json is missing a uuid field.');
    }

    const bundleRoot = path.join(distDir, uuid);
    const outputZip = path.join(distDir, `${uuid}.zip`);

    await fs.mkdir(distDir, {recursive: true});
    await fs.rm(bundleRoot, {recursive: true, force: true});
    await fs.rm(outputZip, {force: true});
    await fs.mkdir(bundleRoot, {recursive: true});

    const filesToCopy = [
        'extension.js',
        'prefs.js',
        'metadata.json',
        'stylesheet.css',
        'LICENSE',
        'README.md',
    ];

    for (const relativePath of filesToCopy) {
        if (await fileExists(path.join(repoRoot, relativePath))) {
            await copyFile(relativePath, bundleRoot);
        }
    }

    const directoriesToCopy = ['schemas', 'static'];
    for (const relativeDir of directoriesToCopy) {
        const absoluteDir = path.join(repoRoot, relativeDir);
        if (await fileExists(absoluteDir)) {
            await copyDirectory(relativeDir, bundleRoot);
        }
    }

    const schemasDir = path.join(bundleRoot, 'schemas');
    if (await fileExists(schemasDir)) {
        await runCommand('glib-compile-schemas', ['schemas'], {cwd: bundleRoot});
    }

    await runCommand('zip', ['-r', outputZip, '.'], {cwd: bundleRoot});
    await fs.rm(bundleRoot, {recursive: true, force: true});
    console.log(`Created ${outputZip}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
