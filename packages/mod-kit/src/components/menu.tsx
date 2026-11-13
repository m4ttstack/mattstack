import { MORE_ACTIONS, menu, menuHit, type MenuHit, type MenuRow, type MenuState } from '../widgets/menu'
import { kitComponent } from './core'

// The menu keeps no state of its own: the Client holds `state` and takes each change through onChange.
export type MenuProps = {
  rows: MenuRow[]
  state: MenuState
  label?: string
  indent?: number
  isSelected?: boolean
  onChange?: (state: MenuState) => void
  onPick?: (id: string) => void
}

const hitKey = (hit: MenuHit) => (hit.type === 'toggle' ? 'toggle' : `row:${hit.path.join('.')}`)

export const Menu = kitComponent('Menu', (props: MenuProps, ctx) =>
  menu({
    ...props.state,
    label: props.label ?? MORE_ACTIONS,
    rows: props.rows,
    width: ctx.width,
    indent: props.indent ?? 0,
    isSelected: props.isSelected ?? false,
    actionFor: hit =>
      ctx.bind(hitKey(hit), () => {
        const move = menuHit(props.state, props.rows, hit)
        props.onChange?.(move.state)
        if (move.picked !== undefined) props.onPick?.(move.picked)
      }),
  }),
)
