import { createContext } from 'react'
import { getEditor, getSplitEditor } from '../editor/session'

/** True inside the split editor group, whose notes have their own editor view. */
export const SplitEditorContext = createContext(false)
export const sessionEditor = (split: boolean) => (split ? getSplitEditor : getEditor)
