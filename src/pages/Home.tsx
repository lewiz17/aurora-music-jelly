import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/i18n'
import { Loader } from '../components/Loader'
import { MediaList } from '../components/MediaList'
import { useJellyfinHomeData } from '../hooks/Jellyfin/useJellyfinHomeData'

export const Home = () => {
    const { t } = useI18n()
    const { recentlyPlayed, frequentlyPlayed, recentlyAdded, recentGenres, isLoading, error } = useJellyfinHomeData()

    if (isLoading) {
        return <Loader />
    }

    if (error) {
        return <div className="error">{error}</div>
    }

    return (
        <div className="home-page">
            <div className="section">
                <div className="section-header">
                    <div className="container">
                        <div className="section_title">{t('home.recently')}</div>
                        <div className="section_desc">{t('home.recently.sub')}</div>
                    </div>
                    {recentlyPlayed && recentlyPlayed.length >= 12 && (
                        <Link to="/recently" className="see-more noSelect">
                            {t('common.seeAll')}
                        </Link>
                    )}
                </div>
                <MediaList
                    items={recentlyPlayed}
                    infiniteData={{ pageParams: [1], pages: [recentlyPlayed || []] }}
                    isLoading={isLoading}
                    type="song"
                    title={t('list.recently')}
                />
            </div>
            <div className="section">
                <div className="section-header">
                    <div className="container">
                        <div className="section_title">{t('home.frequently')}</div>
                        <div className="section_desc">{t('home.frequently.sub')}</div>
                    </div>
                    {frequentlyPlayed && frequentlyPlayed.length >= 12 && (
                        <Link to="/frequently" className="see-more noSelect">
                            {t('common.seeAll')}
                        </Link>
                    )}
                </div>
                <MediaList
                    items={frequentlyPlayed}
                    infiniteData={{ pageParams: [1], pages: [frequentlyPlayed || []] }}
                    isLoading={isLoading}
                    type="song"
                    title={t('list.frequently')}
                />
            </div>
            <div className="section">
                <div className="section-header">
                    <div className="container">
                        <div className="section_title">{t('home.added')}</div>
                        <div className="section_desc">{t('home.added.sub')}</div>
                    </div>
                    {recentlyAdded && recentlyAdded.length >= 12 && (
                        <Link to="/albums?sort=Added" className="see-more noSelect">
                            {t('common.seeAll')}
                        </Link>
                    )}
                </div>
                <MediaList
                    items={recentlyAdded}
                    infiniteData={{ pageParams: [1], pages: [recentlyAdded || []] }}
                    isLoading={isLoading}
                    type="album"
                    title={t('home.added')}
                />
            </div>
            <div className="section">
                <div className="section-header">
                    <div className="container">
                        <div className="section_title">{t('nav.genres')}</div>
                        <div className="section_desc">{t('common.artists')} · {t('nav.genres')}</div>
                    </div>
                    {recentGenres && recentGenres.length >= 12 && (
                        <Link to="/genres" className="see-more noSelect">
                            {t('common.seeAll')}
                        </Link>
                    )}
                </div>
                <MediaList
                    items={recentGenres}
                    infiniteData={{ pageParams: [1], pages: [recentGenres || []] }}
                    isLoading={isLoading}
                    type="genre"
                    title={t('nav.genres')}
                    hidden={{
                        add_to_favorite: true,
                        remove_from_favorite: true,
                    }}
                />
            </div>
        </div>
    )
}
