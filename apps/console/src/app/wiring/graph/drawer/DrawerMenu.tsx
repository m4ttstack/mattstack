import { ActionIcon, Menu } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { useEditorHref } from '../../../editorHref';
import { buildAgentContext } from '../../agentContext';
import { splitCompiledBody } from '../../parseSeam';
import { fetchCompilePreview, useCompositionSnapshot } from '../../useWiring';
import classes from './drawer.module.css';

async function copy(read: () => Promise<string>, what: string) {
  try {
    await navigator.clipboard.writeText(await read());
    notifications.success('Copied');
  } catch (err) {
    notifications.error(`Could not copy ${what}: ${(err as Error).message}`);
  }
}

/** The drawer's actions on the file it shows and the skill it belongs to.
    Its open state is the drawer's, so the drawer's keys stand down while
    the menu has them. */
export function DrawerMenu({
  pack,
  skill,
  filePath,
  opened,
  onChange,
}: {
  pack: string;
  skill: string;
  filePath: string;
  opened: boolean;
  onChange: (opened: boolean) => void;
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

  // From the compile preview rather than the file on disk, so a stale or
  // never-compiled skill copies what a compile would produce now.
  const renderedText = async () => {
    if (!verb) throw new Error(`${skill} is not a verb`);
    const preview = await fetchCompilePreview(queryClient, pack, verb.name);
    return buildAgentContext({
      verb,
      seams: splitCompiledBody(preview.content).map(section => section.seam),
    });
  };

  return (
    <Menu
      position="bottom-end"
      withinPortal
      opened={opened}
      onChange={onChange}
    >
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
        {verb && (
          <Menu.Item
            leftSection={<Icon name="copy" size={14} />}
            onClick={() => void copy(renderedText, 'the rendered text')}
          >
            Copy rendered text
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
