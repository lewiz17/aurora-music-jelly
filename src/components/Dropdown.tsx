import { useDropdownContext } from '../context/DropdownContext/DropdownContext'
import './Dropdown.css'

export const Dropdown = () => {
    const dropdown = useDropdownContext()

    return dropdown.dropdownNode
}
