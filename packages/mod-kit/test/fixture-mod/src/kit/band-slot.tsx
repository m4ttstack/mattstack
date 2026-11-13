import type { ElementConstructor, ClientProps } from 'claude-code'

export function bandSlot(Client: ElementConstructor<ClientProps>, title: string) {
  return <Client key="band" module="./band.tsx" props={{ title }} />
}
