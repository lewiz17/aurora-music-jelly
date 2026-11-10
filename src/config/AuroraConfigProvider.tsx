import { ReactNode } from 'react'
import { AuroraConfigContext, useAuroraConfigQuery } from './AuroraConfig'
import { Loader } from '../components/Loader'

export const AuroraConfigProvider = ({ children }: { children: ReactNode }) => {
    const { data, isPending } = useAuroraConfigQuery()

    if (isPending) {
        return (
            <div className="aurora-boot">
                <div className="aurora-boot-logo" />
                <Loader />
            </div>
        )
    }

    return <AuroraConfigContext.Provider value={data!}>{children}</AuroraConfigContext.Provider>
}
