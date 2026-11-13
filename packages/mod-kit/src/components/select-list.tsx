import { selectList, type Choice } from '../widgets/select-list'
import { kitComponent } from './core'

export type SelectListProps = {
  choices: Choice[]
  cursor: number
  multi?: boolean
  cursorIsChoice?: boolean
  isPicked?: (idx: number) => boolean
  writeIn?: string
  onPick?: (idx: number) => void
  maxShown?: number
}

export const SelectList = kitComponent('SelectList', (props: SelectListProps, ctx) =>
  selectList({
    choices: props.choices,
    cursor: props.cursor,
    multi: props.multi ?? false,
    cursorIsChoice: props.cursorIsChoice ?? false,
    isPicked: props.isPicked ?? (() => false),
    writeIn: props.writeIn ?? '',
    width: ctx.width,
    focused: ctx.focused,
    actionFor: idx => ctx.bind(`pick:${idx}`, () => props.onPick?.(idx)),
    ...(props.maxShown !== undefined && { maxShown: props.maxShown }),
  }),
)
