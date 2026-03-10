#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import pc from 'picocolors';

// Parse positional args properly — skip values that follow flags
const positionalArgs: string[] = [];
const rawArgs = process.argv.slice(2);
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg.startsWith('-')) {
    // Skip the next arg if this flag expects a value (e.g. --template minimal)
    if (!arg.includes('=') && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
      i++;
    }
  } else {
    positionalArgs.push(arg);
  }
}
const projectArg = positionalArgs[0];

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function isValidProjectName(name: string): boolean {
  if (!name || !name.trim()) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return VALID_NAME.test(name);
}

async function resolveLatestCoreVersion(): Promise<string> {
  try {
    const res = await fetch('https://registry.npmjs.org/@wingmanjs/core/latest');
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (data.version) return `^${data.version}`;
    }
  } catch {
    // Fall back to bundled version on network failure
  }
  return '^0.2.1';
}

function toTitle(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  console.log();
  console.log(pc.bold('🛩️  create-wingman-app'));
  console.log();

  const response = await prompts(
    [
      {
        type: projectArg ? null : 'text',
        name: 'name',
        message: 'Project name',
        initial: 'my-wingman-app',
        validate: (v: string) =>
          isValidProjectName(v) || 'Invalid name — use letters, numbers, hyphens, dots, or underscores',
      },
      {
        type: 'text',
        name: 'title',
        message: 'Chat UI title',
        initial: (_: unknown, values: Record<string, string>) =>
          toTitle(values.name ?? projectArg ?? 'My Wingman App'),
      },
      {
        type: 'text',
        name: 'systemPrompt',
        message: 'System prompt',
        initial: 'You are a helpful assistant.',
      },
    ],
    {
      onCancel: () => {
        console.log(pc.red('Cancelled.'));
        process.exit(1);
      },
    },
  );

  const name: string = projectArg ?? response.name;
  const title: string = response.title;
  const systemPrompt: string = response.systemPrompt;

  if (!isValidProjectName(name)) {
    console.log(pc.red(`\n  Invalid project name "${name}" — use letters, numbers, hyphens, dots, or underscores.\n`));
    process.exit(1);
  }

  const dir = path.resolve(process.cwd(), name);

  if (fs.existsSync(dir)) {
    console.log(pc.red(`\n  Directory "${name}" already exists.\n`));
    process.exit(1);
  }

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  const coreVersion = await resolveLatestCoreVersion();

  // package.json
  const pkg = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx src/server.ts',
      build: 'tsc',
      start: 'node dist/server.js',
    },
    dependencies: {
      '@wingmanjs/core': coreVersion,
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      tsx: '^4.0.0',
      typescript: '^5.7.0',
    },
  };
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n',
  );

  // src/server.ts
  const serverTs = `import { startServer, defineConfig } from '@wingmanjs/core';

const config = defineConfig({
  systemPrompt: ${JSON.stringify(systemPrompt)},
  server: { port: 3000 },
  ui: {
    title: ${JSON.stringify(title)},
    welcomeMessage: 'How can I help you today?',
  },
});

await startServer({ config });
`;
  fs.writeFileSync(path.join(dir, 'src', 'server.ts'), serverTs);

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: './src',
      declaration: true,
    },
    include: ['src/**/*'],
  };
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n',
  );

  // .gitignore
  fs.writeFileSync(
    path.join(dir, '.gitignore'),
    'node_modules/\ndist/\n.env\n',
  );

  console.log();
  console.log(pc.green(`  ✅ Created ${pc.bold(name)}`));
  console.log();
  console.log(`  ${pc.cyan('cd')} ${name}`);
  console.log(`  ${pc.cyan('npm install')}`);
  console.log(`  ${pc.cyan('npm run dev')}`);
  console.log();
  console.log(
    `  Open ${pc.underline('http://localhost:3000')} — happy chatting! 🛩️`,
  );
  console.log();
}

main().catch((err) => {
  console.error(pc.red('Error:'), err);
  process.exit(1);
});
