#!/usr/bin/env node
//@ts-check
import inquirer from 'inquirer'
import Spinnies from 'spinnies'
import path from 'path'
import { spawn } from 'child_process'
import fs from 'fs/promises';
import { constants } from 'fs';
import axios from 'axios';

/**
 * async spawn
 * @param {string} cmd Command
 * @param {string[]} args Arguments
 * @param {any} opt Options
 * @returns {Promise<number>} Promise<number>
 */
function spawnAsync(cmd, args, opt) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, opt)
        proc.stderr.pipe(process.stderr);
        proc.on('exit', code => {
            if (code != 0) return reject('Process '+cmd+' exited with code: ' + code);
            resolve(code);
        })
    })
}

const spinnies = new Spinnies();
const pmCommands = {
    npm: {
        install: ['install'],
        install_package: ['install', null],
        install_package_dev: ['install', '-D', null],
        init: ['init', '-y']
    },
    pnpm: {
        install: ['install'],
        install_package: ['add', null],
        install_package_dev: ['add', '-D', null],
        init: ['init']
    },
    yarn: {
        install: ['install'],
        install_package: ['add', null],
        install_package_dev: ['add', '--dev', null],
        init: ['init', '-y']
    },
    
}
/**
 * Replaces `null` in a array with a string
 * @param {any[]} arr Array
 * @param {string} repl The replacement
 * @returns {any[]}
 */
function replace_null(arr, repl) {
    return arr.map(a => a === null ? repl : a);
}

inquirer
    .prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Project name',
            default: '.'
        },
        {
            type: 'confirm',
            name: 'initgit',
            message: 'Do you want to initialize git',
            default: true
        },
        {
            type: 'checkbox',
            name: 'lib',
            message: 'What libraries/wrappers you want to include',
            choices: [
                { name: 'Wifi', value: 'wifi' },
                { name: 'Retro3D', value: 'retro3d' }
            ],
            when: () => false // W.I.P
        },
        {
            type: 'confirm',
            name: 'minify',
            message: 'Add npm script to minify lua output',
            default: true
        },
        {
            type: 'checkbox',
            name: 'tstl_plugins',
            message: 'What typescript-to-lua plugins do you want to include?',
            choices: [
                { name: 'Dreagonmon#7680\'s del_local_before_update',
                    value: {
                        name: './plugins/del_local_before_update.js',
                        download_url: 'https://cdn.discordapp.com/attachments/1047629288729481216/1047898811596550164/del_local_before_update.js'
                    }
                }
            ]
        },
        {
            type: 'list',
            name: 'pkgmgr',
            message: 'What package manager do you want to use',
            choices: [
                'npm',
                'pnpm',
                'yarn'
            ],
            default: 'npm'
        }
    ])
    .then(async answers => {
        const cwd = process.cwd()
        const pcwd = path.join(cwd, "./" + answers.name);
        const asyncJobs = [];
        spinnies.add('projectstructure', { text: 'Create project structure' })
        spinnies.add('initpm', { text: 'Initialize package manager' });
        //spinnies.add('addplugins', { text: 'Add tstl plugins'});
        //spinnies.add('addlib', { text: 'Add libraries'})
        // Project structure
        //console.log(1);
        try { await fs.access(pcwd, constants.R_OK | constants.W_OK) } catch(err) {
            //console.log(err)
            await fs.mkdir(pcwd) // if this fails we're fucked
        }
        //console.log(2);
        await fs.mkdir(path.join(pcwd, "./src"))
        await fs.mkdir(path.join(pcwd, "./dist"))
        await fs.writeFile(path.join(pcwd, "./src/index.ts"), `/// <reference types="retro-gadgets-lua-types" />
// RetroGadgets

// add your components like so:
// type System = Gadget & WithWifi & WithLeds<5>
type System = Gadget & WithCPU;
declare const gdt: System;

// update function is runned every tick
update = (): void => {
    
}`);
        spinnies.succeed('projectstructure')
        
        // Init git
        if (answers.initgit) {
            spinnies.add('initgit', { text: 'Initialize git' });
            asyncJobs.push(
                Promise.all([
                    spawnAsync("git", ["init"], { cwd: pcwd }),
                    fs.writeFile(path.join(pcwd, "./.gitignore"), "node_modules")
                ]).then(_ => spinnies.succeed('initgit'))
            );
        }
        // Init pm
        asyncJobs.push(
            spawnAsync(
                answers.pkgmgr,
                pmCommands[answers.pkgmgr].init,
                { cwd: pcwd, shell: true }
            )
                .then(_ => spinnies.succeed('initpm'))
                .then(_ => addTstl())
                .then(_ => buildScripts())
        )
        // Minify
        if (answers.minify) spinnies.add('addminify', { text: 'Add minifier'});
        function addMinify() {
            if (answers.minify) {
                //console.log(pcwd)
                //spinnies.add('addminify', { text: 'Add minifier'});
                asyncJobs.push(
                    spawnAsync(answers.pkgmgr,
                        replace_null(pmCommands[answers.pkgmgr].install_package_dev, "luamin"),
                        { cwd: pcwd, shell: true }
                    ).then(_ => spinnies.succeed('addminify'))
                )
            }
        }
        // Additional modules
        spinnies.add('addtstl', { text: 'Add typescript-to-lua' });
        function addTstl() {
            asyncJobs.push(
                spawnAsync(answers.pkgmgr,
                    replace_null(pmCommands[answers.pkgmgr].install_package_dev, "typescript-to-lua")
                        .concat(["typescript", "retro-gadgets-lua-types", "lua-types", "@typescript-to-lua/language-extensions"]),
                    { cwd: pcwd, shell: true }
                )
                .then(_ => spinnies.succeed('addtstl'))
                .then(_ => addMinify())
            )
        }

        // Build scripts
        spinnies.add('buildscripts', { text: 'Build scripts' });
        function buildScripts() {
            asyncJobs.push(
                fs.readFile(path.join(pcwd, "./package.json"), { encoding: 'utf-8' })
                    .then(data => {
                        const json = JSON.parse(data);
                        json.scripts.build = "tstl"
                        if (answers.minify)
                            json.scripts.minify = "luamin -f dist/index.lua > output.lua"
                        return fs.writeFile(path.join(pcwd, "./package.json"),
                            JSON.stringify(json, null, 2));
                    })
                    .then(_ => spinnies.succeed('buildscripts'))
            )
        }

        // tsconfig
        spinnies.add('tsconfig', { text: 'Create tsconfig.json' });
        asyncJobs.push(
            fs.writeFile(path.join(pcwd, "./tsconfig.json"), JSON.stringify({
                "compilerOptions": {
                    "target": "esnext",
                    "lib": ["esnext"],
                    "moduleResolution": "node",
                    "types": [],
                    "strict": true,
                    "rootDir": "./src",
                    "outDir": "./dist"
                },
                "tstl": {
                    "luaTarget": "5.1",
                    "noImplicitGlobalVariables": false,
                    "noHeader": true,
                    "luaLibImport": "inline",
                    "luaPlugins": answers.tstl_plugins
                }
            }, null, 2)).then(_ => spinnies.succeed('tsconfig'))
        )
        spinnies.add('dlplugins', { text: 'Download plugins' })
        fs.mkdir(path.join(pcwd, "./plugins")).then(_ => {
            asyncJobs.push(
                Promise.all(answers.tstl_plugins.map(pl =>
                    axios.get(pl.download_url)
                        .then(resp => resp.data)
                        .then(data => 
                            fs.writeFile(path.join(pcwd, pl.name), data))
                ))
                .then(_ => spinnies.succeed('dlplugins'))
            )
        })
        
        await Promise.all(asyncJobs);
    })
    .catch(console.error)