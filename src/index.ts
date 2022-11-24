import path from 'node:path';
import ConfigurationChief from './configuration-chief.js';
import DependencyDeputy from './dependency-deputy.js';
import IssueCollector from './issue-collector.js';
import ProjectPrincipal from './project-principal.js';
import SourceLab from './source-lab.js';
import { compact } from './util/array.js';
import { ROOT_WORKSPACE_NAME } from './util/constants.js';
import { debugLogObject, debugLogFiles } from './util/debug.js';
import { findFile, loadJSON } from './util/fs.js';
import { _glob } from './util/glob.js';
import { loadTSConfig } from './util/tsconfig-loader.js';
import WorkspaceWorker from './workspace-worker.js';
import type { CommandLineOptions } from './types/cli.js';
import type { Report } from './types/issues.js';

export const main = async (unresolvedConfiguration: CommandLineOptions) => {
  const { cwd, gitignore, isStrict, isProduction, isShowProgress } = unresolvedConfiguration;

  const chief = new ConfigurationChief({ cwd });
  const deputy = new DependencyDeputy();

  debugLogObject(1, 'Unresolved configuration', unresolvedConfiguration);

  const collector = new IssueCollector({ cwd, isShowProgress, isProduction });
  collector.updateMessage('Reading configuration and manifest files...');

  await chief.loadLocalConfig();

  const workspaces = await chief.getActiveWorkspaces();

  if (!chief.manifest || !chief.manifestPath) throw new Error('mani');

  debugLogObject(1, 'Included workspaces', workspaces);

  const report = chief.resolveIncludedIssueTypes();

  const workspaceDirs = Object.values(workspaces)
    .map(workspace => workspace.dir)
    .sort((a, b) => b.length - a.length);

  const negatedWorkspacePatterns = Object.values(workspaces)
    .filter(workspace => workspace.name !== ROOT_WORKSPACE_NAME)
    .map(workspace => `!${workspace.name}`);

  const lab = new SourceLab({ report, workspaceDirs });

  const principal = new ProjectPrincipal();

  for (const { name, dir, config, ancestors } of workspaces) {
    const isRoot = name === ROOT_WORKSPACE_NAME;

    const suffix = isRoot ? '' : ` (${name})`;

    const manifestPath = isRoot ? chief.manifestPath : await findFile(dir, 'package.json');
    const manifest = isRoot ? chief.manifest : manifestPath && (await loadJSON(manifestPath));

    if (!manifestPath || !manifest) continue;

    deputy.addWorkspace({ name, dir, manifestPath, manifest, isProduction });

    const tsConfigFilePath = path.join(dir, 'tsconfig.json');
    const tsConfig = await loadTSConfig(tsConfigFilePath);

    if (isRoot && tsConfig) {
      principal.tsConfigFilePath = tsConfigFilePath;
    }

    if (tsConfig?.compilerOptions?.paths) {
      deputy.addTypeScriptConfigPathGlobs(name, tsConfig.compilerOptions.paths);
      principal.addTypeScriptPaths(dir, tsConfig.compilerOptions.paths);
    }

    collector.updateMessage(`Resolving custom dependencies...${suffix}`);

    const workspaceManifest = deputy.getWorkspaceManifest(name);

    if (!workspaceManifest) continue;

    const worker = new WorkspaceWorker({
      name,
      dir,
      config,
      rootWorkspaceConfig: chief.getConfigForWorkspace(ROOT_WORKSPACE_NAME),
      manifest,
      // @ts-ignore
      ancestorManifests: ancestors.map(name => deputy.getManifest(name)),
      rootConfig: chief.config,
      negatedWorkspacePatterns,
      rootWorkspaceDir: cwd,
    });

    await worker.init();

    // Add listed peer dependencies, as they're often not referenced anywhere, used to settle dependencies at the end
    deputy.addPeerDependencies(name, worker.peerDependencies);

    if (config?.entryFiles && config?.projectFiles) {
      /**
       * Production mode:
       * - Resolve entry files
       * - Resolve project files
       * - Resolve production plugin entry files
       *
       * Non-production mode:
       * - Resolve entry files
       * - Resolve project files
       * - Resolve plugin entry files
       * - Resolve plugin project files
       * - Resolve plugin configuration files
       */
      if (isProduction) {
        collector.updateMessage(`Resolving entry files${suffix}...`);
        const workspaceEntryPaths = await _glob({
          cwd,
          workingDir: dir,
          patterns: worker.getProductionEntryFilePatterns(),
          ignore: worker.getWorkspaceIgnorePatterns(),
          gitignore,
        });
        debugLogFiles(1, `Globbed entry paths${suffix}`, workspaceEntryPaths);
        workspaceEntryPaths.forEach(entryPath => principal.addEntryPath(entryPath));

        collector.updateMessage(`Resolving production plugin entry files${suffix}...`);
        const pluginWorkspaceEntryPaths = await _glob({
          cwd,
          workingDir: dir,
          patterns: worker.getProductionPluginEntryFilePatterns(),
          ignore: worker.getWorkspaceIgnorePatterns(),
          gitignore,
        });
        debugLogFiles(1, `Globbed production plugin entry paths${suffix}`, pluginWorkspaceEntryPaths);
        pluginWorkspaceEntryPaths.forEach(entryPath => principal.addEntryPath(entryPath));
        // pluginWorkspaceEntryPaths.forEach(entryPath => principal.addProjectPath(entryPath));
        pluginWorkspaceEntryPaths.forEach(entryPath => lab.skipExportsAnalysisFor(entryPath));

        if (workspaceEntryPaths.length > 0 || pluginWorkspaceEntryPaths.length > 0) {
          collector.updateMessage(`Resolving project files${suffix}...`);
          const workspaceProjectPaths = await _glob({
            cwd,
            workingDir: dir,
            patterns: worker.getProductionProjectFilePatterns(),
            ignore: worker.getWorkspaceIgnorePatterns(),
            gitignore,
          });
          debugLogFiles(1, `Globbed project paths${suffix}`, workspaceProjectPaths);
          workspaceProjectPaths.forEach(projectPath => principal.addProjectPath(projectPath));
        }

        // Without source files, better cancel the workspace for dependency settling
        if (workspaceEntryPaths.length === 0 && pluginWorkspaceEntryPaths.length === 0) {
          deputy.cancelWorkspace(name);
        }
      } else {
        {
          collector.updateMessage(`Resolving entry files${suffix}...`);

          const workspaceEntryPaths = await _glob({
            cwd,
            workingDir: dir,
            patterns: worker.getEntryFilePatterns(),
            ignore: worker.getWorkspaceIgnorePatterns(),
            gitignore,
          });
          debugLogFiles(1, `Globbed entry paths${suffix}`, workspaceEntryPaths);
          workspaceEntryPaths.forEach(entryPath => principal.addEntryPath(entryPath));
        }

        {
          collector.updateMessage(`Resolving project files${suffix}...`);

          const workspaceProjectPaths = await _glob({
            cwd,
            workingDir: dir,
            patterns: worker.getProjectFilePatterns(),
            ignore: worker.getWorkspaceIgnorePatterns(),
            gitignore,
          });
          debugLogFiles(1, `Globbed project paths${suffix}`, workspaceProjectPaths);
          workspaceProjectPaths.forEach(projectPath => principal.addProjectPath(projectPath));
        }

        {
          collector.updateMessage(`Resolving plugin entry files${suffix}...`);

          const pluginWorkspaceEntryPaths = await _glob({
            cwd,
            workingDir: dir,
            patterns: worker.getPluginEntryFilePatterns(),
            ignore: worker.getWorkspaceIgnorePatterns(),
            gitignore,
          });
          debugLogFiles(1, `Globbed plugin entry paths${suffix}`, pluginWorkspaceEntryPaths);
          pluginWorkspaceEntryPaths.forEach(entryPath => principal.addEntryPath(entryPath));
          pluginWorkspaceEntryPaths.forEach(entryPath => lab.skipExportsAnalysisFor(entryPath));
        }

        {
          collector.updateMessage(`Resolving plugin project files${suffix}...`);

          const pluginWorkspaceProjectPaths = await _glob({
            cwd,
            workingDir: dir,
            patterns: worker.getPluginProjectFilePatterns(),
            ignore: worker.getWorkspaceIgnorePatterns(),
            gitignore,
          });
          debugLogFiles(1, `Globbed plugin project paths${suffix}`, pluginWorkspaceProjectPaths);
          pluginWorkspaceProjectPaths.forEach(projectPath => principal.addProjectPath(projectPath));
          pluginWorkspaceProjectPaths.forEach(entryPath => lab.skipExportsAnalysisFor(entryPath));
        }

        {
          collector.updateMessage(`Resolving plugin configuration files${suffix}...`);
          const configurationEntryPaths = await _glob({
            cwd,
            workingDir: dir,
            patterns: compact(worker.getPluginConfigPatterns()),
            ignore: worker.getWorkspaceIgnorePatterns(),
            gitignore,
          });
          debugLogFiles(1, `Globbed plugin configuration paths${suffix}`, configurationEntryPaths);

          configurationEntryPaths.forEach(entryPath => principal.addEntryPath(entryPath));
          configurationEntryPaths.forEach(entryPath => principal.addProjectPath(entryPath));
          configurationEntryPaths.forEach(entryPath => lab.skipExportsAnalysisFor(entryPath));
        }
      }

      if (!isProduction && (report.dependencies || report.unlisted || report.files)) {
        const { referencedDependencyIssues, referencedDependencies } = await worker.findDependenciesByPlugins();

        const rootDependencies = deputy.getAllDependencies(ROOT_WORKSPACE_NAME);
        const workspaceDependencies = deputy.getAllDependencies(name);

        // Add referenced dependencies to settle them at the end
        for (const packageName of workspaceDependencies) {
          if (referencedDependencies.has(packageName)) {
            deputy.addReferencedDependency(name, packageName);
          }
        }

        for (const issue of referencedDependencyIssues) {
          // Referenced files "block" the `addFilesIssues` we'll do later on
          if (issue.symbol.startsWith('/')) {
            collector.referencedFiles.add(issue.symbol);
          } else {
            issue.symbol = deputy.resolvePackageName(issue.symbol);
            if (!deputy.isInternalDependency(name, issue.symbol)) {
              if (!workspaceDependencies.includes(issue.symbol)) {
                // Unlisted referenced dependencies can be marked as an issue right away (for instant progress output)
                if (isStrict) {
                  collector.addIssue('unlisted', issue);
                } else if (!rootDependencies.includes(issue.symbol)) {
                  collector.addIssue('unlisted', issue);
                }
              }
            }
          }
        }
      }
    }
  }

  collector.setReport(report);

  const { usedProductionFiles, unreferencedProductionFiles } = principal.settleFiles();

  collector.setProjectFilesCount(unreferencedProductionFiles.size + usedProductionFiles.length);

  collector.addFilesIssues(unreferencedProductionFiles);

  collector.updateMessage('Connecting the dots...');

  usedProductionFiles.forEach(sourceFile => {
    collector.counters.processed++;
    const filePath = sourceFile.getFilePath();
    const workspaceDir = workspaceDirs.find(workspaceDir => filePath.startsWith(workspaceDir));
    const workspace = workspaces.find(workspace => workspace.dir === workspaceDir);
    const { externalModuleSpecifiers, issues } = lab.analyzeSourceFile(sourceFile);
    issues.forEach(issue => collector.addIssue(issue.type, issue));
    if (workspace) {
      externalModuleSpecifiers.forEach(moduleSpecifier => {
        const unlistedDependency = deputy.maybeAddListedReferencedDependency(workspace, moduleSpecifier, isStrict);
        if (unlistedDependency) collector.addIssue('unlisted', { filePath, symbol: unlistedDependency });
      });
    }
  });

  collector.removeProgress();

  const { dependencyIssues, devDependencyIssues } = deputy.settleDependencyIssues();

  dependencyIssues.forEach(issue => collector.addIssue('dependencies', issue));
  if (!isProduction) {
    devDependencyIssues.forEach(issue => collector.addIssue('devDependencies', issue));
  }

  const { issues, counters } = collector.getIssues();

  debugLogObject(3, 'Issues', issues);

  return { report: report as Report, issues, counters };
};
