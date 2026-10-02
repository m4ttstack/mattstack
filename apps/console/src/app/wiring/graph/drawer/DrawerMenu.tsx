import { ActionIcon, Menu } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { useEditorHref } from '../../../editorHref';
import { buildAgentContext } from '../../agentContext';
import { splitCompiledBody } from '../../parseSeam';
import { fetchSkillSource, useCompositionSnapshot } from '../../useWiring';
import classes from './drawer.module.css';

async function copy(read: () => Promise<string>, what: string) {
  try {
    await navigator.clipboard.writeText(await read());
    notifications.success('Copied');
  } catch (err) {
    notifications.error(`Could not copy ${what}: ${(err as Error).message}`);
  }
}

/** The drawer's actions on the file it shows and the skill it belongs to. */
export function DrawerMenu({
  pack,
  skill,
  filePath,
  renderedPath,
}: {
  pack: string;
  skill: string;
  filePath: string;
  /** The skill's compiled file, or null when it has never been compiled. */
  renderedPath: string | null;
}) {
  const queryClient = useQueryClient();
  const editorHref = useEditorHref();
  const composition = useCompositionSnapshot(pack).data;
  const verb = composition?.verbs.find(v => v.name === skill) ?? null;
  // Only a pack checkout is edited in place; an engine file is the installed
  // plugin's read-only copy.
  const editable =
    composition?.packDir != null &&
    filePath.startsWith(`${composition.packDir}/`);

  const compiledBody = async () => {
    if (!renderedPath) throw new Error('it has never been compiled');
    return (await fetchSkillSource(queryClient, pack, renderedPath)).content;
  };

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="soft-outline"
          radius={6}
          className={classes.more}
          aria-label="More actions"
          data-parity="ActionIcon · more"
          data-testid="drawer-menu"
        >
          <Icon name="moreHorizontal" size={15} data-parity="i" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {renderedPath && (
          <Menu.Item
            leftSection={<Icon name="copy" size={14} />}
            onClick={() => void copy(compiledBody, 'the rendered text')}
          >
            Copy rendered text
          </Menu.Item>
        )}
        {renderedPath && verb && (
          <Menu.Item
            leftSection={<Icon name="copy" size={14} />}
            onClick={() =>
              void copy(
                async () =>
                  buildAgentContext({
                    verb,
                    seams: splitCompiledBody(await compiledBody()).map(
                      section => section.seam
                    ),
                  }),
                'agent context'
              )
            }
          >
            Copy agent context
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<Icon name="copy" size={14} />}
          onClick={() => void copy(async () => filePath, 'the path')}
        >
          Copy path
        </Menu.Item>
        {editable && (
          <Menu.Item
            component="a"
            href={editorHref(filePath)}
            leftSection={<Icon name="edit" size={14} />}
          >
            Open in editor
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
