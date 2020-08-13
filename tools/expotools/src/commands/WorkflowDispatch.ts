import { Command } from '@expo/commander';
import { request } from '@octokit/request';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import path from 'path';

import { filterAsync } from '../Utils';
import { EXPO_DIR } from '../Constants';
import Git from '../Git';

type CommandOptions = {
  ref?: string;
};

type Workflow = {
  id: number;
  name: string;
};

export default (program: Command) => {
  program
    .command('workflow-dispatch [workflowName]')
    .alias('dispatch', 'wd')
    .option(
      '-r, --ref <ref>',
      'The reference of the workflow run. The reference can be a branch, tag, or a commit SHA.'
    )
    .description('Dispatches a workflow on GitHub Actions.')
    .asyncAction(main);
};

/**
 * Main action of the command.
 */
async function main(workflowName: string | undefined, options: CommandOptions) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('Environment variable `GITHUB_TOKEN` must be set.');
  }
  const workflows = await getWorkflowsAsync();
  const workflowId = await findWorkflowIdAsync(workflows, workflowName);
  const ref = options.ref || (await Git.getCurrentBranchNameAsync());

  if (!workflowId) {
    throw new Error('Unable to find workflow ID.');
  }

  console.log(workflowName, workflowId, ref);

  await dispatchWorkflowAsync(workflowId, ref);
}

/**
 * Requests for the list of active workflows.
 */
async function getWorkflowsAsync(): Promise<Workflow[]> {
  const response = await request('GET /repos/:owner/:repo/actions/workflows', {
    owner: 'expo',
    repo: 'expo',
  });

  // Some workflows in expo/expo have empty `name` or `path` (why?) so filter them out.
  const workflows = await filterAsync(response.data.workflows, async (workflow) =>
    Boolean(
      workflow.name &&
        workflow.path &&
        workflow.state === 'active' &&
        (await fs.pathExists(path.join(EXPO_DIR, workflow.path)))
    )
  );
  return workflows.sort((a, b) => a.name.localeCompare(b.name));
}

async function findWorkflowIdAsync(
  workflows: Workflow[],
  workflowName: string | undefined
): Promise<number | null> {
  if (workflowName) {
    return workflows.find((workflow) => workflow.name === workflowName)?.id ?? null;
  } else {
    if (process.env.CI) {
      throw new Error('Command requires `workflowName` argument when run on the CI.');
    }
    return await promptWorkflowIdAsync(workflows);
  }
}

async function dispatchWorkflowAsync(workflowId: number, ref: string) {
  await request('POST /repos/:owner/:repo/actions/workflows/:workflow_id/dispatches', {
    headers: {
      authorization: `token ${process.env.GITHUB_TOKEN}`,
    },
    owner: 'expo',
    repo: 'expo',
    workflow_id: workflowId,
    ref,
  });
}

async function promptWorkflowIdAsync(workflows: Workflow[]): Promise<number> {
  const { workflowId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'workflowId',
      message: 'Which workflow you want to dispatch?',
      choices: workflows.map((workflow) => ({ name: workflow.name, value: workflow.id })),
      pageSize: workflows.length,
    },
  ]);
  return workflowId;
}
