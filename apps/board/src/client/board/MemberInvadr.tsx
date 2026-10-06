import { createContext, useContext } from 'react';
import { Invadr } from 'invadrs/react';

import type { MemberLook } from './invadr-colors.ts';

const MemberLooks = createContext<ReadonlyMap<string, MemberLook>>(new Map());

/** Each roster member's assigned avatar colour and creature, so every
    avatar of one person matches and no two people share either. */
export const MemberLooksProvider = MemberLooks.Provider;

export function useMemberLook(id: string): MemberLook | undefined {
  return useContext(MemberLooks).get(id);
}

/** A person's avatar in their assigned colour and creature. Someone off the
    roster keeps invadrs' own hashed pick of both. */
export function MemberInvadr({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const look = useMemberLook(id);
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
