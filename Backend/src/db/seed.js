require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool, withTransaction } = require("../config/db");

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const USERS = [
    { name: "Ava Thompson", email: "ava@example.com", password: "password123", avatar_url: "https://i.pravatar.cc/150?u=ava@example.com" },
    { name: "Liam Chen", email: "liam@example.com", password: "password123", avatar_url: "https://i.pravatar.cc/150?u=liam@example.com" },
    { name: "Sofia Ramirez", email: "sofia@example.com", password: "password123", avatar_url: "https://i.pravatar.cc/150?u=sofia@example.com" },
    { name: "Noah Patel", email: "noah@example.com", password: "password123", avatar_url: "https://i.pravatar.cc/150?u=noah@example.com" },
    { name: "Emma Wilson", email: "emma@example.com", password: "password123", avatar_url: "https://i.pravatar.cc/150?u=emma@example.com" },
];

const DEFAULT_COLUMNS = ["Todo", "In Progress", "Review", "Done"];

const PRIORITIES = ["low", "medium", "high", "urgent"];

const BOARDS = [
    {
        title: "Product Launch",
        description: "Everything needed to ship the Q3 product launch.",
        color: "#6366F1",
        ownerEmail: "ava@example.com",
        memberEmails: ["liam@example.com", "sofia@example.com"],
        tasks: {
            Todo: [
                { title: "Draft press release", priority: "high", assigneeEmail: "sofia@example.com", daysFromNow: 5 },
                { title: "Finalize pricing tiers", priority: "urgent", assigneeEmail: "ava@example.com", daysFromNow: 2 },
                { title: "Record demo video", priority: "medium", assigneeEmail: "liam@example.com", daysFromNow: 10 },
            ],
            "In Progress": [
                { title: "Landing page redesign", priority: "high", assigneeEmail: "liam@example.com", daysFromNow: 4 },
                { title: "Set up analytics tracking", priority: "medium", assigneeEmail: "ava@example.com", daysFromNow: 7 },
            ],
            Review: [
                { title: "Review onboarding copy", priority: "low", assigneeEmail: "sofia@example.com", daysFromNow: 3 },
            ],
            Done: [
                { title: "Kickoff meeting notes", priority: "low", assigneeEmail: "ava@example.com", daysFromNow: -6 },
                { title: "Competitor research", priority: "medium", assigneeEmail: "sofia@example.com", daysFromNow: -3 },
            ],
        },
    },
    {
        title: "Website Redesign",
        description: "Refresh the marketing site with the new brand system.",
        color: "#10B981",
        ownerEmail: "liam@example.com",
        memberEmails: ["ava@example.com", "noah@example.com", "emma@example.com"],
        tasks: {
            Todo: [
                { title: "Audit existing site content", priority: "medium", assigneeEmail: "emma@example.com", daysFromNow: 8 },
                { title: "Design new component library", priority: "high", assigneeEmail: "noah@example.com", daysFromNow: 6 },
            ],
            "In Progress": [
                { title: "Build homepage hero section", priority: "high", assigneeEmail: "liam@example.com", daysFromNow: 3 },
                { title: "Migrate blog to new CMS", priority: "urgent", assigneeEmail: "noah@example.com", daysFromNow: 1 },
                { title: "Mobile navigation revamp", priority: "medium", assigneeEmail: "emma@example.com", daysFromNow: 9 },
            ],
            Review: [
                { title: "Accessibility audit", priority: "high", assigneeEmail: "ava@example.com", daysFromNow: 2 },
            ],
            Done: [
                { title: "Choose typography system", priority: "low", assigneeEmail: "liam@example.com", daysFromNow: -10 },
            ],
        },
    },
    {
        title: "Personal Tasks",
        description: "A private board for day-to-day to-dos.",
        color: "#F59E0B",
        ownerEmail: "noah@example.com",
        memberEmails: [],
        tasks: {
            Todo: [
                { title: "Book dentist appointment", priority: "low", assigneeEmail: "noah@example.com", daysFromNow: 14 },
                { title: "Renew driver's license", priority: "medium", assigneeEmail: "noah@example.com", daysFromNow: 20 },
            ],
            "In Progress": [
                { title: "Plan weekend trip", priority: "low", assigneeEmail: "noah@example.com", daysFromNow: 5 },
            ],
            Review: [],
            Done: [
                { title: "Pay electricity bill", priority: "medium", assigneeEmail: "noah@example.com", daysFromNow: -1 },
            ],
        },
    },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const daysFromNow = (n) => {
    if (n === undefined || n === null) return null;
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
};

const clearDatabase = async (client) => {
    console.log("Clearing existing data...");
    await client.query("TRUNCATE TABLE activities, tasks, columns, board_members, boards, users RESTART IDENTITY CASCADE");
};

const insertUsers = async (client) => {
    console.log("Seeding users...");
    const emailToId = {};
    for (const u of USERS) {
        const password_hash = await bcrypt.hash(u.password, 10);
        const { rows } = await client.query(
            `INSERT INTO users (name, email, password_hash, avatar_url)
             VALUES ($1, $2, $3, $4)
             RETURNING id, email`,
            [u.name, u.email, password_hash, u.avatar_url]
        );
        emailToId[rows[0].email] = rows[0].id;
    }
    return emailToId;
};

const insertBoards = async (client, emailToId) => {
    console.log("Seeding boards, columns, tasks and activity...");

    for (const board of BOARDS) {
        const ownerId = emailToId[board.ownerEmail];

        const { rows: boardRows } = await client.query(
            `INSERT INTO boards (title, description, color, owner_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [board.title, board.description, board.color, ownerId]
        );
        const boardId = boardRows[0].id;

        // Owner is always a board member with role 'owner'.
        await client.query(
            `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'owner')`,
            [boardId, ownerId]
        );

        for (const memberEmail of board.memberEmails) {
            const memberId = emailToId[memberEmail];
            if (!memberId || memberId === ownerId) continue;
            await client.query(
                `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'member')`,
                [boardId, memberId]
            );
        }

        // Columns
        const columnIds = {};
        for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
            const title = DEFAULT_COLUMNS[i];
            const { rows } = await client.query(
                `INSERT INTO columns (board_id, title, position) VALUES ($1, $2, $3) RETURNING id`,
                [boardId, title, (i + 1) * 1000]
            );
            columnIds[title] = rows[0].id;
        }

        // Tasks
        for (const columnTitle of DEFAULT_COLUMNS) {
            const tasksForColumn = board.tasks[columnTitle] || [];
            for (let i = 0; i < tasksForColumn.length; i++) {
                const t = tasksForColumn[i];
                const priority = PRIORITIES.includes(t.priority) ? t.priority : "medium";
                const assigneeId = t.assigneeEmail ? emailToId[t.assigneeEmail] : null;

                const { rows } = await client.query(
                    `INSERT INTO tasks (board_id, column_id, title, description, priority, due_date, assignee_id, position, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     RETURNING id, title`,
                    [
                        boardId,
                        columnIds[columnTitle],
                        t.title,
                        t.description || null,
                        priority,
                        daysFromNow(t.daysFromNow),
                        assigneeId,
                        (i + 1) * 1000,
                        ownerId,
                    ]
                );

                const task = rows[0];
                await client.query(
                    `INSERT INTO activities (board_id, user_id, action, message, metadata)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        boardId,
                        ownerId,
                        "task.created",
                        `${board.ownerEmail.split("@")[0]} created "${task.title}"`,
                        JSON.stringify({ taskId: task.id }),
                    ]
                );
            }
        }

        // Board creation activity
        await client.query(
            `INSERT INTO activities (board_id, user_id, action, message, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                boardId,
                ownerId,
                "board.created",
                `${board.ownerEmail.split("@")[0]} created the board "${board.title}"`,
                JSON.stringify({ boardId }),
            ]
        );

        console.log(`  -> Board "${board.title}" seeded with ${DEFAULT_COLUMNS.length} columns.`);
    }
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

(async () => {
    try {
        await withTransaction(async (client) => {
            await clearDatabase(client);
            const emailToId = await insertUsers(client);
            await insertBoards(client, emailToId);
        });
        console.log("Database seeded successfully.");
        console.log("\nSample login credentials (all users share the same password):");
        USERS.forEach((u) => console.log(`  ${u.email} / ${u.password}`));
    } catch (err) {
        console.error("Failed to seed database:", err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();