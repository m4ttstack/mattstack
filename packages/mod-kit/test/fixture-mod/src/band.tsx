import type { ClientSurface } from 'claude-code'

export default function Band(props: { title: string }, surface: ClientSurface) {
  const { Text } = surface.elements
  return <Text>{props.title}</Text>
}
