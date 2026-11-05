import { createContext, useContext, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Invadr } from 'invadrs/react';

import { faceZoom } from '@mattstack/rt-client/face-zoom';
import type { MemberLook } from './invadr-colors.ts';

const FACE_RETRY_MS = 60_000;

const MemberLooks = createContext<ReadonlyMap<string, MemberLook>>(new Map());

/** Each roster member's assigned avatar colour and creature, so every
    avatar of one person matches and no two people share either. */
export const MemberLooksProvider = MemberLooks.Provider;

export function useMemberLook(id: string): MemberLook | undefined {
  return useContext(MemberLooks).get(id);
}

/** A person's Slack picture when one matched, else their avatar in their
    assigned colour and creature. Someone off the roster keeps invadrs' own
    hashed pick of both. */
export function MemberInvadr({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const look = useMemberLook(id);
  const [failed, setFailed] = useState<string>();
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!failed) return;
    const retry = setTimeout(() => setFailed(undefined), FACE_RETRY_MS);
    return () => clearTimeout(retry);
  }, [failed]);
  className = className ? `tui-invadr ${className}` : 'tui-invadr';
  if (look?.face && look.face !== failed) {
    return (
      <span
        className={`tui-slack-face ${className}`}
        style={{ '--face-ring': look.fill } as CSSProperties}
      >
        <img
          src={look.face}
          alt=""
          style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}
          onLoad={event => setZoom(faceZoom(event.currentTarget))}
          onError={() => setFailed(look.face)}
        />
      </span>
    );
  }
  return look ? (
    <Invadr
      id={id}
      palette={[...look.palette]}
      sprite={look.sprite}
      color={look.color}
      className={className}
    />
  ) : (
    <Invadr id={id} palette="css-vars" className={className} />
  );
}
