import { AnimatePresence, motion as m } from "framer-motion"
import { ActionsModal, ImagesModal } from "./ChatsModal"
import { useEffect, useRef, useState } from "react"
import EmojiPicker from "emoji-picker-react"
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc, Timestamp, updateDoc } from "firebase/firestore"
import { db } from "@/firebase"
import { v4 as uuidv4 } from 'uuid';
import Skeleton from "../ui/Skeleton"
import { useAuthStore } from "@/store/UserId"
import upload from "@/hooks/upload"
import { Messages } from "@/types/chat"
import { formatDate, formatTime12Hour } from "@/constants"
import { useChatIdStore } from "@/store/ChatStore"
import toast from "react-hot-toast"

interface SelectedChatTwoProps {
    activePage: boolean
    closePage: () => void
    updateChatId: (newChatId: string) => void;
}

const SelectedChatTwo: React.FC<SelectedChatTwoProps> = ({ activePage, closePage, updateChatId }) => {
    const [showActionsModal, setShowActionsModal] = useState<'action' | 'hidden'>("hidden");
    const [text, setText] = useState<string>('');
    const [openEmoji, setOpenEmoji] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const {chatId, reset} = useChatIdStore();


    //images
    const [image, setImage] = useState<{ file: File | null, url: string | null }>({
        file: null,
        url: null
    })

    const imageRef = useRef<HTMLInputElement | null>(null);

    const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setImage({
                file: e.target.files[0],
                url: URL.createObjectURL(e.target.files[0]),
            })
        }
    }

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setOpenEmoji(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => { document.removeEventListener("mousedown", handleClickOutside); };
    }, []);

    // current user id
    const { auth } = useAuthStore();
    const currentUserId = auth?.uid as string;

    //getting recipient user's name and profile picture from query params i.e the 
    const queryParams = new URLSearchParams(location.search);
    const reciepientUserId = queryParams.get('recipient-user-id');

    const [userDetails, setUserDetails] = useState<{ name: string | null, profilePicture: string | null, status: {online: boolean, lastSeen: string} | null }>({ name: null, profilePicture: null, status: null });

    const [isLoading, setIsLoading] = useState<boolean>(true);


    useEffect(() => {
        let isMounted = true;
        const getUserDetails = async () => {
            setIsLoading(true);
            try {
                const docRef = doc(db, "users", reciepientUserId as string);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setUserDetails({
                        name: data?.first_name || null,
                        profilePicture: (data?.photos && Array.isArray(data.photos) && data.photos.length > 0) ? data.photos[0] : null,
                        status: {online: data?.status?.online, lastSeen: data?.status?.lastSeen}
                    });
                } else { console.log('Selectedchat: No such document'); }
                setIsLoading(false);
            } catch (error) { console.log("Error getting document:", error); }
        }

        if (isMounted && reciepientUserId) {
            getUserDetails();
        }

        return () => {
            isMounted = false;
            setUserDetails({ name: null, profilePicture: null, status: null });
        };
    }, [reciepientUserId]);

    //sending text message to the recipient
    const handleSendMessage = async () => {
        const allchats = await getDocs(collection(db, "allchats"));
        const recipientsId: string[] = [];
        let imgUrl: string | null = null;

        allchats.forEach((doc) => {
            const result = doc.id;
            recipientsId.push(result);
        });

        // Generate the messageId and timestamp upfront
        const messageId = uuidv4();
        const timestamp = new Date().toISOString();

        // Create optimistic message object with a placeholder for image if it's being uploaded
        const optimisticMessage: Messages = {
            id: messageId,
            senderId: currentUserId,
            message: text !== '' ? text : null,
            photo: image.file ? 'loading_image_placeholder' : null, // Placeholder for image
            timestamp,
        };

        // Optimistically add the message to the chat array
        setChats(prevChats => [...prevChats, optimisticMessage]);

        // Clear input fields
        setText('');
        setImage({ file: null, url: null });

        try {
            if (image.file) {
                // Upload the image and get the URL
                imgUrl = await upload(image.file);

                // Update the chat array with the real image URL after the upload is done
                setChats(prevChats => prevChats.map(chat =>
                    chat.id === messageId ? { ...chat, photo: imgUrl } : chat
                ));
            }

            // Check if chat exists and send message to Firebase
            const existingChat = recipientsId.some((id) => id.includes(reciepientUserId as string) && id.includes(currentUserId));
            let chatToUpdateId = chatId as string;

            if (!existingChat) {
                const newChatId = `${currentUserId}_${reciepientUserId}`;
                chatToUpdateId = newChatId;
                await setDoc(
                    doc(db, "allchats", newChatId), {
                    lastMessage: text || 'Sent a photo',
                    lastMessageId: messageId,
                    lastSenderId: currentUserId,
                    userBlocked: [false, false],
                    participants: [currentUserId, reciepientUserId],
                }
                );
                updateChatId(newChatId);
            }

            // Send the message to Firebase
            const messageRef = doc(db, `allchats/${chatToUpdateId}/messages`, messageId);
            await setDoc(messageRef, {
                id: messageId,
                senderId: currentUserId,
                message: text !== '' ? text : null,
                photo: imgUrl ?? null,
                timestamp,
            });

            // Update chat with last message
            await updateDoc(doc(db, "allchats", chatToUpdateId), {
                lastMessage: text || 'Image',
                lastMessageId: messageId,
                lastSenderId: currentUserId,
            });

        } catch (err) {
            console.error('Error sending message:', err);

            // Remove the optimistic message if there was an error
            setChats(prevChats => prevChats.filter(chat => chat.id !== optimisticMessage.id));
        }
    };

    const [chats, setChats] = useState<any[]>([]);

    useEffect(() => {
        if (!chatId) return;
        const messagesRef = query(collection(db, `allchats/${chatId}/messages`), orderBy("timestamp", "asc"));
        const unSub = onSnapshot(messagesRef, (snapshot) => {
            const messages = snapshot.docs.map(doc => ({
                id: doc.id, // Get the document id
                ...doc.data() // Spread the document data
            }));
            setChats(messages);
        }, (err) => console.log(err))
        return () => { unSub(); setChats([]) }
    }, [chatId])


    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (endRef.current) {
            endRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chats])

    return (
        <AnimatePresence>
            {activePage &&
                <>
                    <ActionsModal show={showActionsModal === "action"} hide={() => setShowActionsModal('hidden')} chatName="Temidire" blockUser={() => toast.error('This function isn\'t available yet')} reportUser={() => toast.error('This function isn\'t available yet')} />
                    <ImagesModal show={Boolean(image.url)} imageUrl={image.url as string} hide={() => setImage({ file: null, url: null })} chatName="Davido" blockUser={() => console.log('You have benn blocked')} reportUser={() => console.log('You have been reported')} sendImage={handleSendMessage} text={text} setText={(text) => setText(text)} />
                    <m.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }} transition={{ duration: 0.3 }} className=' relative bg-white flex flex-col min-h-full'>
                        <header className=" text-[1.8rem] py-[1.6rem] px-[2.4rem] flex justify-between items-center" style={{ borderBottom: '1px solid #F6F6F6' }}>
                            <button className="settings-page__title__left gap-x-1" onClick={closePage}>
                                <img src="/assets/icons/back-arrow-black.svg" className="settings-page__title__icon" />
                                {!isLoading ? userDetails.profilePicture ? <img className='size-[4.8rem] mr-2 object-cover rounded-full' src={userDetails.profilePicture} alt="profile picture" /> : <div className="rounded-full size-[4.8rem] bg-[#D3D3D3] flex justify-center items-center font-semibold mr-2" >{userDetails.name?.charAt(0)}</div> : <Skeleton width="4.8rem" height="4.8rem" className="rounded-full" />}
                                <div className="space-y-1">
                                    {userDetails.name ? <p className="font-bold">{userDetails.name}</p> : <Skeleton width="8rem" height="1.6rem" />}
                                    {userDetails.status?.online && <p className="text-[#8A8A8E] font-normal">online</p>}
                                </div>
                            </button>
                            <button className="cursor-pointer" onClick={() => setShowActionsModal('action')}>
                                <img src="/assets/icons/three-dots.svg" alt="" />
                            </button>
                        </header>
                        <section className="text-[1.6rem] text-[#121212] flex-1 px-8 flex flex-col overflow-y-scroll pb-20 no-scrollbar">
                            <section className="messages flex flex-col gap-y-6 h-[calc(100vh-32.4rem)] overflow-y-scroll no-scrollbar ">
                                {chats && Array.isArray(chats) && chats.length !== 0 && <header className=" mt-[1.5rem] flex justify-center"><p>Conversation started on {formatDate(chats[0]?.timestamp)}</p></header>}
                                {/* <div className="max-w-[70%] flex gap-x-2 items-center">
                                    <div>
                                        <p className="bg-[#F6F6F6] py-[1.6rem] px-[1.2rem]" style={{borderTopLeftRadius: '1.2rem', borderTopRightRadius: '1.2rem', borderBottomLeftRadius: '0.4rem', borderBottomRightRadius: '1.2rem'}}>Hi, nice to meet you my name is temidire owoeye and I am a student </p>
                                        <p className="flex justify-start mt-2 text-[#828181]"> <img src="/assets/icons/delivered.svg" alt="" /> Seen: 1 min ago</p>
                                    </div>
                                </div>
                                <div className="max-w-[70%] flex self-end">
                                    <div>
                                        <p className="bg-[#E5F2FF] py-[1.6rem] px-[1.2rem]" style={{borderTopLeftRadius: '1.2rem', borderTopRightRadius: '1.2rem', borderBottomLeftRadius: '1.2rem', borderBottomRightRadius: '0.4rem'}}>Hi, nice to meet you</p>
                                        <p className="flex justify-end mt-2 text-[#828181]"> <img src="/assets/icons/delivered.svg" alt="" /> Sent: 1 min ago</p>
                                    </div>
                                </div> 
                            */}
                                {chats && Array.isArray(chats) && chats?.map((message: Messages, i: number) =>
                                    <div className={`max-w-[70%] flex ${message.senderId === auth?.uid ? " flex-col self-end our_message" : ' gap-x-2 items-start flex-col their_message'}`} key={i}
                                    // key={message.createAt}
                                    >
                                        <div className="flex flex-col">
                                            {message.photo && message.photo !== 'loading_image_placeholder' ? <img className='mr-2 max-h-[30rem] w-full object-contain ' src={message.photo as string} alt="profile picture" /> : message.photo === 'loading_image_placeholder' && <Skeleton width="30rem" height="30rem" />}
                                            {message.message && <p className={`${message.senderId === auth?.uid ? 'bg-[#E5F2FF]  self-end' : 'bg-[#F6F6F6]'} py-[1.6rem] px-[1.2rem] mt-4 w-fit`} style={{ borderTopLeftRadius: '1.2rem', borderTopRightRadius: '1.2rem', borderBottomLeftRadius: message.senderId === auth?.uid ? '1.2rem' : '0.4rem', borderBottomRightRadius: message.senderId === auth?.uid ? '0.4rem' : '1.2rem' }}>{message.message}</p>}
                                        </div>
                                        <p className="flex justify-end mt-2 text-[#cfcfcf]">
                                            {/* <img src="/assets/icons/delivered.svg" alt="" />  */}
                                            {formatTime12Hour(message.timestamp)}</p>
                                    </div>)
                                }
                                {/* <button onClick={() => console.log(Timestamp.now())}>click</button> */}
                                {/* <div>hello {JSON.stringify(chatId)}</div> */}

                                <div ref={endRef} />
                            </section>
                        </section>
                        <AnimatePresence>{openEmoji && <m.div initial={{ opacity: 0, scale: 0.8, y: 50 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8, y: 50 }} transition={{ duration: 0.3, ease: "easeInOut" }} ref={dropdownRef} className="absolute bottom-32 right-8 "><EmojiPicker onEmojiClick={(e) => setText((prev) => prev + e.emoji)} /> </m.div>}</AnimatePresence>
                        <footer className="flex justify-between text-[1.6rem] bg-white items-center gap-x-4 mx-6 sticky bottom-10">
                            <div className="flex-1 flex gap-x-4">
                                <img className="size-[4.4rem] cursor-pointer" src="/assets/icons/add-image.svg" alt="" onClick={() => imageRef.current?.click()} />
                                <input type="file" className="hidden" ref={imageRef} onChange={handleImage} accept="image/*" />
                                <div className="flex bg-[#F6F6F6] w-full rounded-l-full px-5 items-center rounded-r-full overflow-hidden"><input type="text" className="bg-inherit outline-none w-full" placeholder="say something nice" value={image.url ? "" : text} onChange={(e) => setText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key == 'Enter') { handleSendMessage() } else return; }}
                                /> <img className="size-[1.6rem] ml-4 cursor-pointer" src="/assets/icons/emoji.svg" alt="Emoji selector" onClick={() => setOpenEmoji(true)} /> </div>
                            </div>
                            <div className="space-x-4">
                                <button className="bg-black text-white py-4 font-semibold px-4 rounded-full cursor-pointer"
                                    onClick={handleSendMessage}
                                >Send</button>
                            </div>
                        </footer>
                        {/* <button><img src="/assets/icons/chat-gift.svg" alt="" /></button> */}
                        {/* <button><img src="/assets/icons/mic.svg" alt="" /></button> */}
                    </m.div>
                </>}
        </AnimatePresence>
    )
}

export default SelectedChatTwo