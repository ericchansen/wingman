#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import pc from 'picocolors';

const args = process.argv.slice(2);
const projectArg = args.find((a) => !a.startsWith('-'));

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
  const dir = path.resolve(process.cwd(), name);

  if (fs.existsSync(dir)) {
    console.log(pc.red(`\n  Directory "${name}" already exists.\n`));
    process.exit(1);
  }

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

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
      '@wingmanjs/core': '^0.2.1',
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
