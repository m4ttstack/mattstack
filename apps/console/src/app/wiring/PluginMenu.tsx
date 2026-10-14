import { Button, SearchableMenu } from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';

type PluginItem = { name: string };

/** Packs no team owns (a plugin served from a marketplace, an org base
    pack), picked apart from the team menu so none reads as a team. */
export function PluginMenu({
  plugins,
  pack,
  onPick,
}: {
  plugins: string[];
  pack: string | null;
  onPick: (pack: string) => void;
}) {
  const shown = pack !== null && plugins.includes(pack) ? pack : null;
  const label = shown ?? (plugins.length === 1 ? plugins[0] : 'Plugins');
  return (
    <SearchableMenu<PluginItem>
      menuTrigger={
        <Button
          size="compact-sm"
          radius="xl"
          variant={shown ? 'light' : 'default'}
          color="gray"
          leftSection={<Icons.package size={14} />}
          rightSection={<Icons.chevronsUpDown size={14} />}
          aria-label={
            shown
              ? `plugin: ${shown}, switch plugin`
              : 'pick a plugin, switch plugin'
          }
        >
          {label}
        </Button>
      }
      items={plugins.map(name => ({ name }))}
      title="Plugins"
      titleIcon={<Icons.package size={14} />}
      itemTitle={item => item.name}
      isSelectedItem={item => item.name === shown}
      showItemBadge={item => item.name === shown}
      itemBadgeText="Selected"
      onItemClick={item => onPick(item.name)}
      filterPlaceholder={() => 'Find plugin…'}
      emptyMessage="No plugin matches"
      position="bottom-start"
    />
  );
}
