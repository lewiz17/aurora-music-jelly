import { createContext, useContext } from 'react'
import { IDropdownContext } from './DropdownContextProvider'

export const DropdownContext = createContext<IDropdownContext>({} as IDropdownContext)

export const useDropdownContext = () => useContext(DropdownContext)
