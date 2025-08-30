import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, setDoc, deleteDoc, onSnapshot, query, where, Timestamp, writeBatch } from 'firebase/firestore';
import { CheckCircle2, Circle, ArrowRight, BrainCircuit, Trash2, Plus, ChevronLeft, ChevronRight, CalendarDays, Edit2 } from 'lucide-react';

// Firebase 구성 정보 (실제 환경에서는 이 변수들이 자동으로 제공됩니다)
// eslint-disable-next-line no-undef
const firebaseConfig = {
    apiKey: "AIzaSyDCJ3I1-J2J6WhJLtgfm8-uWzMusN1fMZY",
    authDomain: "adhd-journal-app.firebaseapp.com",
    projectId: "adhd-journal-app",
    storageBucket: "adhd-journal-app.firebasestorage.app",
    messagingSenderId: "1069608889994",
    appId: "1:1069608889994:web:763f028a9f2fa9b69b0773",
    measurementId: "G-2PGN0FCNTQ"
};

// eslint-disable-next-line no-undef
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-adhd-journal';

// Firebase 앱 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 날짜 포맷 함수
const formatDate = (date) => {
    return date.toISOString().split('T')[0];
};

const getKoreanDateString = (date) => {
    return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
    }).format(date);
};

// 할 일 항목 컴포넌트
const TaskItem = ({ task, onUpdate, onDelete, onMigrate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [content, setContent] = useState(task.content);

    const handleStatusClick = () => {
        const newStatus = task.status === 'todo' ? 'done' : 'todo';
        onUpdate(task.id, { status: newStatus });
    };

    const handleContentBlur = () => {
        setIsEditing(false);
        if (task.content !== content) {
            onUpdate(task.id, { content });
        }
    };

    const handleContentKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleContentBlur();
        }
    };

    return (
        <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-700 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200">
            <div className="flex items-center gap-3 flex-1">
                <button onClick={handleStatusClick} className="flex-shrink-0">
                    {task.status === 'done' ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} className="text-gray-400" />}
                </button>
                {isEditing ? (
                    <input
                        type="text"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onBlur={handleContentBlur}
                        onKeyDown={handleContentKeyDown}
                        autoFocus
                        className="w-full bg-transparent focus:outline-none dark:text-gray-200 p-1 -m-1 ring-2 ring-blue-500 rounded"
                    />
                ) : (
                    <span
                        className={`w-full dark:text-gray-200 ${task.status === 'done' ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}
                    >
                        {task.content}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-2">
                {task.status === 'todo' && !isEditing && (
                    <button onClick={() => setIsEditing(true)} title="수정" className="p-1 text-gray-400 hover:text-yellow-500 transition-colors">
                        <Edit2 size={18} />
                    </button>
                )}
                {task.status === 'todo' && (
                    <button onClick={() => onMigrate(task.id)} title="다음 날로 미루기" className="p-1 text-gray-400 hover:text-blue-500 transition-colors">
                        <ArrowRight size={18} />
                    </button>
                )}
                <button onClick={() => onDelete(task.id)} title="삭제" className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );
};

// 브레인 덤프 항목 컴포넌트
const BrainDumpItem = ({ item, onConvertToTask, onDelete }) => (
    <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-700 rounded-lg shadow-sm">
        <span className="dark:text-gray-200">{item.content}</span>
        <div className="flex items-center gap-2">
            <button onClick={() => onConvertToTask(item)} title="할 일로 전환" className="p-1 text-gray-400 hover:text-green-500 transition-colors">
                <Plus size={18} />
            </button>
            <button onClick={() => onDelete(item.id)} title="삭제" className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 size={18} />
            </button>
        </div>
    </div>
);


export default function App() {
    const [userId, setUserId] = useState(null);
    const [tasks, setTasks] = useState([]);
    const [brainDumps, setBrainDumps] = useState([]);
    const [newTask, setNewTask] = useState('');
    const [newBrainDump, setNewBrainDump] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [activeTab, setActiveTab] = useState('tasks');
    const [loading, setLoading] = useState(true);

    const todayStr = useMemo(() => formatDate(new Date()), []);
    const currentDateStr = useMemo(() => formatDate(currentDate), [currentDate]);

    // Firebase 인증 처리
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                try {
                    const { user: anonUser } = await signInAnonymously(auth);
                    setUserId(anonUser.uid);
                } catch (error) {
                    console.error("익명 로그인 실패:", error);
                }
            }
        });
        return () => unsubscribe();
    }, []);

    // 데이터 로딩 (할 일)
    useEffect(() => {
        if (!userId) return;

        setLoading(true);
        const tasksQuery = query(
            collection(db, `artifacts/${appId}/users/${userId}/entries`),
            where('type', '==', 'task'),
            where('date', '==', currentDateStr)
        );
        const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
            const fetchedTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTasks(fetchedTasks);
            setLoading(false);
        }, (error) => {
            console.error("할 일 데이터 로딩 실패:", error);
            setLoading(false);
        });

        return () => unsubscribeTasks();
    }, [userId, currentDateStr]);

    // 데이터 로딩 (브레인 덤프)
    useEffect(() => {
        if (!userId) return;

        const brainDumpQuery = query(
            collection(db, `artifacts/${appId}/users/${userId}/entries`),
            where('type', '==', 'braindump')
        );
        const unsubscribeBrainDumps = onSnapshot(brainDumpQuery, (snapshot) => {
            const fetchedDumps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBrainDumps(fetchedDumps);
        }, (error) => {
            console.error("브레인 덤프 데이터 로딩 실패:", error);
        });

        return () => unsubscribeBrainDumps();
    }, [userId]);


    const handleAddTask = async (e) => {
        e.preventDefault();
        if (newTask.trim() === '' || !userId) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/entries`), {
                content: newTask,
                status: 'todo',
                type: 'task',
                date: currentDateStr,
                createdAt: Timestamp.now(),
            });
            setNewTask('');
        } catch (error) {
            console.error("할 일 추가 실패:", error);
        }
    };

    const handleAddBrainDump = async (e) => {
        e.preventDefault();
        if (newBrainDump.trim() === '' || !userId) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/entries`), {
                content: newBrainDump,
                type: 'braindump',
                createdAt: Timestamp.now(),
            });
            setNewBrainDump('');
        } catch (error) {
            console.error("브레인 덤프 추가 실패:", error);
        }
    };

    const handleUpdateTask = useCallback(async (id, updates) => {
        if (!userId) return;
        const taskDocRef = doc(db, `artifacts/${appId}/users/${userId}/entries`, id);
        try {
            await setDoc(taskDocRef, updates, { merge: true });
        } catch (error) {
            console.error("할 일 업데이트 실패:", error);
        }
    }, [userId]);

    const handleDelete = useCallback(async (id) => {
        if (!userId) return;
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/entries`, id);
        try {
            await deleteDoc(docRef);
        } catch (error) {
            console.error("항목 삭제 실패:", error);
        }
    }, [userId]);

    const handleMigrateTask = useCallback(async (id) => {
        if (!userId) return;
        const nextDay = new Date(currentDate);
        nextDay.setDate(currentDate.getDate() + 1);
        const nextDayStr = formatDate(nextDay);
        await handleUpdateTask(id, { date: nextDayStr });
        setTasks(prevTasks => prevTasks.filter(task => task.id !== id));
    }, [userId, currentDate, handleUpdateTask]);

    const handleConvertToTask = useCallback(async (item) => {
        if (!userId) return;
        const batch = writeBatch(db);

        // 새 할 일 추가
        const newTaskRef = doc(collection(db, `artifacts/${appId}/users/${userId}/entries`));
        batch.set(newTaskRef, {
            content: item.content,
            status: 'todo',
            type: 'task',
            date: todayStr,
            createdAt: Timestamp.now(),
        });

        // 기존 브레인 덤프 삭제
        const brainDumpRef = doc(db, `artifacts/${appId}/users/${userId}/entries`, item.id);
        batch.delete(brainDumpRef);

        try {
            await batch.commit();
        } catch (error) {
            console.error("할 일 전환 실패:", error);
        }
    }, [userId, todayStr]);

    const changeDate = (amount) => {
        setCurrentDate(prevDate => {
            const newDate = new Date(prevDate);
            newDate.setDate(newDate.getDate() + amount);
            return newDate;
        });
    };

    const goToToday = () => {
        setCurrentDate(new Date());
    };

    const sortedTasks = useMemo(() => {
        return [...tasks].sort((a, b) => {
            if (a.status === b.status) return 0;
            if (a.status === 'done') return 1;
            if (b.status === 'done') return -1;
            return 0;
        });
    }, [tasks]);

    return (
        <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 font-sans text-gray-800 dark:text-gray-200">
            <header className="p-4 border-b dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800">
                <h1 className="text-2xl font-bold text-center text-gray-700 dark:text-gray-100">Journal</h1>
            </header>

            <main className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto">
                <div className="max-w-2xl w-full mx-auto">
                    {/* 날짜 네비게이션 */}
                    {activeTab === 'tasks' && (
                        <div className="flex items-center justify-between mb-4">
                            <button onClick={() => changeDate(-1)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"><ChevronLeft /></button>
                            <div className="text-center">
                                <h2 className="text-xl font-semibold">{getKoreanDateString(currentDate)}</h2>
                                {currentDateStr !== todayStr && (
                                    <button onClick={goToToday} className="text-sm text-blue-500 hover:underline">오늘로 돌아가기</button>
                                )}
                            </div>
                            <button onClick={() => changeDate(1)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"><ChevronRight /></button>
                        </div>
                    )}

                    {/* 탭 */}
                    <div className="flex border-b dark:border-gray-700 mb-4">
                        <button
                            onClick={() => setActiveTab('tasks')}
                            className={`flex-1 py-2 text-center font-semibold transition-colors ${activeTab === 'tasks' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-500'}`}
                        >
                            <CalendarDays className="inline-block mr-2" size={20} />
                            오늘 할 일 ({tasks.filter(t => t.status === 'todo').length})
                        </button>
                        <button
                            onClick={() => setActiveTab('braindump')}
                            className={`flex-1 py-2 text-center font-semibold transition-colors ${activeTab === 'braindump' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-500'}`}
                        >
                            <BrainCircuit className="inline-block mr-2" size={20} />
                            브레인 덤프 ({brainDumps.length})
                        </button>
                    </div>

                    {/* 컨텐츠 영역 */}
                    <div className="space-y-3">
                        {activeTab === 'tasks' && (
                            <>
                                {loading ? <p className="text-center text-gray-500">로딩 중...</p> :
                                    sortedTasks.length > 0 ? (
                                        sortedTasks.map(task => (
                                            <TaskItem key={task.id} task={task} onUpdate={handleUpdateTask} onDelete={handleDelete} onMigrate={handleMigrateTask} />
                                        ))
                                    ) : (
                                        <p className="text-center text-gray-500 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">할 일이 없습니다. 휴식을 취하거나 새 할 일을 추가하세요!</p>
                                    )}
                            </>
                        )}

                        {activeTab === 'braindump' && (
                            <>
                                {brainDumps.length > 0 ? (
                                    brainDumps.map(item => (
                                        <BrainDumpItem key={item.id} item={item} onConvertToTask={handleConvertToTask} onDelete={handleDelete} />
                                    ))
                                ) : (
                                    <p className="text-center text-gray-500 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">떠오르는 생각을 여기에 적어두세요.</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </main>

            {/* 입력 폼 */}
            <footer className="p-4 bg-white dark:bg-gray-800 border-t dark:border-gray-700">
                <div className="max-w-2xl mx-auto">
                    {activeTab === 'tasks' ? (
                        <form onSubmit={handleAddTask} className="flex gap-2">
                            <input
                                type="text"
                                value={newTask}
                                onChange={(e) => setNewTask(e.target.value)}
                                placeholder="새로운 할 일 추가..."
                                className="flex-1 p-3 border-2 border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition bg-gray-100 dark:bg-gray-700"
                            />
                            <button type="submit" className="px-6 py-3 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition-colors disabled:bg-blue-300" disabled={!newTask.trim()}>
                                추가
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleAddBrainDump} className="flex gap-2">
                            <input
                                type="text"
                                value={newBrainDump}
                                onChange={(e) => setNewBrainDump(e.target.value)}
                                placeholder="생각을 빠르게 기록하세요..."
                                className="flex-1 p-3 border-2 border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition bg-gray-100 dark:bg-gray-700"
                            />
                            <button type="submit" className="px-6 py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors disabled:bg-green-300" disabled={!newBrainDump.trim()}>
                                기록
                            </button>
                        </form>
                    )}
                </div>
            </footer>
        </div>
    );
}