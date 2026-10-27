import { Anchor } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type {
  PayloadBlock,
  PayloadSegment,
} from '../../../server/blocksPayload';
import { useEditorHref } from '../../editorHref';
import classes from './blocks.module.css';
import { MarkdownText } from './MarkdownText';

export interface PropBoxProps {
  prop: PayloadBlock['props'][number];
  /** This prop's segments, in order: one per value for `add`, the winner for `replace`. */
  segments: PayloadSegment[];
  /** A segment's layer as the band names it. */
  layerName?: (segment: PayloadSegment) => string;
  /** The packs in the stack, by name: a binding that names one of them
      binds that pack's file. */
  packs?: string[];
}

/** The pack whose file a binding names, as `<pack>:<path>`; null for a
    binding with no pack. */
export const ownerOf = (binding: string) =>
  binding.includes(':') ? binding.slice(0, binding.indexOf(':')) : null;

const UNDER = /\/(?:attachments|skills)\/(.+)$/;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A prop at its marker: one band per layer's value, ruled in the layer's
    colour, naming who passed it and the file it comes from. */
export function PropBox({
  prop,
  segments,
  layerName = segment =>
    segment.color === 'mattstack' ? 'mattstack' : segment.layer,
  packs = [],
}: PropBoxProps) {
  const editorHref = useEditorHref();
  const sourceOf = (segment: PayloadSegment, index: number) => {
    const value =
      prop.values.find(candidate => candidate.layer === segment.layer) ??
      prop.values[index];
    if (!value) return undefined;
    const owner = ownerOf(value.binding);
    return {
      name: UNDER.exec(value.path)?.[1] ?? value.binding,
      href: value.path.startsWith('/') ? editorHref(value.path) : null,
      // A layer can bind another pack's file: the base's, say.
      from:
        owner && owner !== layerName(segment) && packs.includes(owner)
          ? owner
          : null,
    };
  };
  const titleOf = (segment: PayloadSegment) => {
    const who = layerName(segment);
    if (segment.color === 'mattstack')
      return `${capital(prop.name)}: ${who}'s default`;
    return prop.merge === 'replace'
      ? `Set by ${who}`
      : `${capital(prop.name)} added by ${who}`;
  };

  return (
    <div
      className={classes.propBands}
      data-testid="prop-box"
      data-prop={prop.name}
    >
      {segments.length === 0 ? (
        <section className={classes.propBand} data-layer="none">
          <header className={classes.propBandHead}>
            <Icon name="plug" size={13} className={classes.propBandIcon} />
            <span className={classes.propBandTitle}>{capital(prop.name)}</span>
            <span className={classes.propBandMeta}>
              {prop.default
                ? `nothing passed · default ${prop.default}`
                : 'nothing passed'}
            </span>
          </header>
        </section>
      ) : (
        segments.map((segment, index) => {
          const source = sourceOf(segment, index);
          return (
            <section
              key={`${segment.layer}-${index}`}
              className={classes.propBand}
              data-layer={segment.color}
              data-testid="prop-card"
            >
              <header className={classes.propBandHead}>
                <Icon name="plug" size={13} className={classes.propBandIcon} />
                <span className={classes.propBandTitle}>
                  {titleOf(segment)}
                </span>
                {source?.from && (
                  <span className={classes.propBandMeta}>
                    {`its file from ${source.from}`}
                  </span>
                )}
                {prop.merge === 'replace' && segment.color !== 'mattstack' && (
                  <span className={classes.propBandMeta}>
                    {`replaces mattstack's default${prop.default ? '' : ' (none)'}`}
                  </span>
                )}
                {source &&
                  (source.href ? (
                    <Anchor
                      href={source.href}
                      className={classes.propBandSource}
                      title="Open the file"
                      data-testid="prop-source"
                    >
                      {source.name}
                      <Icon name="externalLink" size={11} />
                    </Anchor>
                  ) : (
                    <span className={classes.propBandSource}>
                      {source.name}
                    </span>
                  ))}
              </header>
              <MarkdownText text={segment.text} />
            </section>
          );
        })
      )}
    </div>
  );
}
