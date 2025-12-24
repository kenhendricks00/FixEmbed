/**
 * FixEmbed Service - Threads Handler
 * 
 * Implements Threads embed support using their internal GraphQL API.
 * Based on fixthreads implementation (https://github.com/milanmdev/fixthreads)
 */

import { Env, HandlerResponse, PlatformHandler } from '../types';
import { truncateText } from '../utils/fetch';
import { platformColors, getBrandedSiteName, formatStats } from '../utils/embed';

// Convert Threads short code to numeric post ID
function decodeThreadsPostId(shortcode: string): string {
    // Clean up the shortcode
    let threadID = shortcode.split('?')[0];
    threadID = threadID.replace(/\s/g, '');
    threadID = threadID.replace(/\//g, '');

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let postID = 0n;
    for (const letter of threadID) {
        postID = postID * 64n + BigInt(alphabet.indexOf(letter));
    }
    return postID.toString();
}

interface ThreadsGraphQLResponse {
    data?: {
        data?: {
            edges?: Array<{
                node?: {
                    thread_items?: Array<{
                        post?: {
                            code?: string;
                            user?: {
                                username?: string;
                                profile_pic_url?: string;
                            };
                            caption?: {
                                text?: string;
                            };
                            like_count?: number;
                            text_post_app_info?: {
                                direct_reply_count?: number;
                            };
                            image_versions2?: {
                                candidates?: Array<{
                                    url?: string;
                                    width?: number;
                                    height?: number;
                                }>;
                            };
                            video_versions?: Array<{
                                url?: string;
                                width?: number;
                                height?: number;
                            }>;
                            carousel_media?: Array<{
                                image_versions2?: {
                                    candidates?: Array<{ url?: string }>;
                                };
                                video_versions?: Array<{ url?: string }>;
                            }>;
                        };
                    }>;
                };
            }>;
        };
    };
    errors?: Array<{ summary?: string; message?: string }>;
}

async function fetchThreadsGraphQL(postCode: string): Promise<{
    success: boolean;
    username?: string;
    caption?: string;
    likes?: number;
    replies?: number;
    images?: string[];
    videoUrl?: string;
    profilePic?: string;
    error?: string;
}> {
    try {
        const postID = decodeThreadsPostId(postCode);

        const variables = JSON.stringify({
            check_for_unavailable_replies: true,
            first: 10,
            postID: postID,
            __relay_internal__pv__BarcelonaIsLoggedInrelayprovider: true,
            __relay_internal__pv__BarcelonaIsThreadContextHeaderEnabledrelayprovider: false,
            __relay_internal__pv__BarcelonaIsThreadContextHeaderFollowButtonEnabledrelayprovider: false,
            __relay_internal__pv__BarcelonaUseCometVideoPlaybackEnginerelayprovider: false,
            __relay_internal__pv__BarcelonaOptionalCookiesEnabledrelayprovider: false,
            __relay_internal__pv__BarcelonaIsViewCountEnabledrelayprovider: false,
            __relay_internal__pv__BarcelonaShouldShowFediverseM075Featuresrelayprovider: false,
        });

        const formBody = new URLSearchParams({
            variables,
            doc_id: '7448594591874178',
            lsd: 'hgmSkqDnLNFckqa7t1vJdn',
        });

        const response = await fetch('https://www.threads.net/api/graphql', {
            method: 'POST',
            headers: {
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'X-Fb-Lsd': 'hgmSkqDnLNFckqa7t1vJdn',
                'X-Ig-App-Id': '238260118697367',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formBody.toString(),
        });

        if (!response.ok) {
            return { success: false, error: `API returned ${response.status}` };
        }

        const data = await response.json() as ThreadsGraphQLResponse;

        // Check for errors
        if (data.errors && data.errors.length > 0) {
            return { success: false, error: data.errors[0].summary || 'API error' };
        }

        // Navigate the response structure
        const edges = data.data?.data?.edges;
        if (!edges || edges.length === 0) {
            return { success: false, error: 'No thread data found' };
        }

        const threadItems = edges[0]?.node?.thread_items;
        if (!threadItems || threadItems.length === 0) {
            return { success: false, error: 'No thread items found' };
        }

        // Find the specific post by code
        const postObj = threadItems.find(item => item.post?.code === postCode);
        const post = postObj?.post || threadItems[0]?.post;

        if (!post) {
            return { success: false, error: 'Post not found' };
        }

        // Extract data
        const username = post.user?.username || 'Unknown';
        const caption = post.caption?.text || '';
        const likes = post.like_count || 0;
        const replies = post.text_post_app_info?.direct_reply_count || 0;
        const profilePic = post.user?.profile_pic_url;

        // Get all images (for carousel support)
        const images: string[] = [];

        // Check carousel_media first for multiple images
        if (post.carousel_media && post.carousel_media.length > 0) {
            for (const item of post.carousel_media) {
                if (item.image_versions2?.candidates && item.image_versions2.candidates.length > 0) {
                    images.push(item.image_versions2.candidates[0].url!);
                }
            }
        }

        // Fallback to single image from post
        if (images.length === 0 && post.image_versions2?.candidates && post.image_versions2.candidates.length > 0) {
            images.push(post.image_versions2.candidates[0].url!);
        }

        // Get video URL
        let videoUrl: string | undefined;
        if (post.video_versions && post.video_versions.length > 0) {
            videoUrl = post.video_versions[0].url;
        }

        // Check carousel for video
        if (!videoUrl && post.carousel_media) {
            for (const item of post.carousel_media) {
                if (item.video_versions && item.video_versions.length > 0) {
                    videoUrl = item.video_versions[0].url;
                    break;
                }
            }
        }

        return {
            success: true,
            username,
            caption,
            likes,
            replies,
            images,
            videoUrl,
            profilePic,
        };
    } catch (error) {
        console.error('Threads GraphQL fetch error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export const threadsHandler: PlatformHandler = {
    name: 'threads',
    patterns: [
        /threads\.net\/@?([^\/]+)\/post\/([^\/\?]+)/i,
        /threads\.net\/t\/([^\/\?]+)/i,
    ],

    async handle(url: string, env: Env): Promise<HandlerResponse> {
        // Parse URL to extract post info
        const postMatch = url.match(/threads\.net\/@?([^\/]+)\/post\/([^\/\?]+)/i);
        const shortMatch = url.match(/threads\.net\/t\/([^\/\?]+)/i);

        if (!postMatch && !shortMatch) {
            return { success: false, error: 'Invalid Threads URL' };
        }

        let username = postMatch?.[1] || 'Thread';
        let postCode = postMatch?.[2] || shortMatch?.[1] || '';

        // Clean up username (remove @ if present)
        username = username.replace('@', '');

        try {
            // Try GraphQL API first
            const graphqlResult = await fetchThreadsGraphQL(postCode);

            if (graphqlResult.success) {
                const displayUsername = graphqlResult.username || username;
                const description = graphqlResult.caption
                    ? truncateText(graphqlResult.caption, 280)
                    : '';

                // Build stats for oEmbed row
                const statsStr = formatStats({
                    likes: graphqlResult.likes,
                    comments: graphqlResult.replies,
                });

                const result: HandlerResponse = {
                    success: true,
                    data: {
                        title: description || 'Thread',
                        description: statsStr || '',
                        url: url,
                        siteName: getBrandedSiteName('threads'),
                        authorName: `@${displayUsername}`,
                        authorUrl: `https://threads.net/@${displayUsername}`,
                        color: platformColors.threads,
                        platform: 'threads',
                        stats: statsStr,
                    },
                };

                // Add video if available
                if (graphqlResult.videoUrl) {
                    // Use video proxy like we do for Instagram
                    const embedDomain = (env as any).EMBED_DOMAIN || 'embed.ken.tools';
                    const proxyVideoUrl = `https://${embedDomain}/video/threads?url=${encodeURIComponent(graphqlResult.videoUrl)}`;

                    const firstImage = graphqlResult.images?.[0];

                    result.data!.video = {
                        url: proxyVideoUrl,
                        width: 0,
                        height: 0,
                        thumbnail: firstImage,
                    };
                    result.data!.image = firstImage;
                } else if (graphqlResult.images && graphqlResult.images.length > 0) {
                    // Multiple images (carousel) - use images array
                    result.data!.images = graphqlResult.images;
                    result.data!.image = graphqlResult.images[0]; // Also set single image as fallback
                } else if (graphqlResult.profilePic) {
                    // Fallback to profile pic
                    result.data!.image = graphqlResult.profilePic;
                }

                return result;
            }

            // GraphQL failed, try oEmbed as fallback
            try {
                const oembedUrl = `https://www.threads.net/oembed/?url=${encodeURIComponent(url)}`;
                const response = await fetch(oembedUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; FixEmbed/1.0)',
                    },
                });

                if (response.ok) {
                    const data = await response.json() as {
                        author_name?: string;
                        title?: string;
                        thumbnail_url?: string;
                    };

                    return {
                        success: true,
                        data: {
                            title: data.title ? truncateText(data.title, 100) : 'Thread',
                            description: data.title ? truncateText(data.title, 280) : '',
                            url: url,
                            siteName: getBrandedSiteName('threads'),
                            authorName: `@${data.author_name || username}`,
                            authorUrl: `https://threads.net/@${username}`,
                            image: data.thumbnail_url,
                            color: platformColors.threads,
                            platform: 'threads',
                        },
                    };
                }
            } catch (e) {
                // oEmbed failed, continue with fallback
            }

            // Final fallback: return basic info
            return {
                success: true,
                data: {
                    title: 'Thread',
                    description: '',
                    url: url,
                    siteName: getBrandedSiteName('threads'),
                    authorName: `@${username}`,
                    authorUrl: `https://threads.net/@${username}`,
                    color: platformColors.threads,
                    platform: 'threads',
                },
            };
        } catch (error) {
            console.error('Threads handler error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch thread',
                redirect: url,
            };
        }
    },
};
