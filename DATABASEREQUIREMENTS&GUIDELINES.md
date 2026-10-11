# Guidelines and Requirements

## General Instructions

Create and publish a functional web-based information system that stores and retrieves data through a backend connected to **Supabase PostgreSQL**. The frontend must be deployed on **Vercel** so that the instructor can access and test the system online.

Grading focuses on the database and backend, including database connectivity, data modeling and normalization, ERD, data integrity, working backend operations, the group presentation, and each member's individual knowledge and contribution.

## Requirements

- Solve a clear record-management problem such as inventory, sales, appointments, library records, enrollment, service requests, or another approved topic.
- Use at least three meaningful and related database tables. Each table must have a clear purpose and suitable columns.
- Implement Create, Read, Update, and Delete (CRUD) operations for the main records. Operations must affect the Supabase PostgreSQL database, not temporary or hard-coded data.
- Use a backend/API as the controlled connection between the web interface and the database. The browser must not contain exposed database credentials or privileged secret keys.
- Apply server-side validation, correct data types, required fields, duplicate prevention where appropriate, and clear error handling.
- Use environment variables for database connection strings, API keys, and secrets. Do not submit usernames, passwords, or secret keys in public source code.
- Prepare a logical ERD showing entities or tables, attributes, primary keys, foreign keys, relationships, and correct cardinalities.
- Show normalization up to Third Normal Form (3NF) as a logical database design exercise. Explain how the normalized relational design was implemented in Supabase PostgreSQL.
- Provide sufficient sample data to demonstrate relationships, validation, queries, and all CRUD operations during evaluation.

## Database Modeling and Normalization

Supabase uses PostgreSQL, a relational database management system. Students must present a normalized logical database model up to Third Normal Form (3NF) before implementing the physical database.

The database design must identify tables, primary keys, foreign keys, candidate keys where applicable, and relationships. It must minimize unnecessary duplication and maintain data consistency through appropriate constraints.

Students must demonstrate the transformation from an unnormalized form to First Normal Form (1NF), Second Normal Form (2NF), and Third Normal Form (3NF). They must then explain how the final design was implemented in Supabase PostgreSQL using relational tables, primary and foreign keys, constraints, indexes, and appropriate SQL queries.

## Required Submission

1. **Vercel frontend URL:** A publicly accessible URL that allows the instructor to test the system.
2. **Live backend/API URL:** The deployed backend URL and a short list of available endpoints or operations.
3. **Supabase PostgreSQL database evidence:** Table names, representative records, primary and foreign keys, validation constraints, indexes, and evidence of working data changes.
4. **ERD:** A PDF or image with readable tables, fields, primary keys, foreign keys, relationships, and cardinalities.
5. **Normalization evidence:** Documentation showing the transformation from unnormalized data to 1NF, 2NF, and 3NF, followed by a brief explanation of the final PostgreSQL database structure.
6. **Source-code repository or compressed project folder:** Include the frontend, backend/API, database SQL scripts or migrations, and a safe `.env.example` file without real credentials.
7. **Short demonstration:** Show the database connection, CRUD operations, server-side validation, relationship handling, and deployed integration between the frontend, backend, and Supabase PostgreSQL.

## Evaluation Rubric

### Group/Application Grade

| Criteria | Points | What Is Expected |
|---|---:|---|
| Database Connection and Security | 5 | The backend connects reliably to Supabase PostgreSQL in the deployed system. Connection settings use environment variables, credentials and privileged keys remain protected, and connection failures are handled clearly. |
| Database Design and Normalization | 5 | The logical design reaches 3NF with correct functional dependencies and minimal redundancy. PostgreSQL tables, data types, keys, constraints, and relationships are appropriate and clearly explained. |
| ERD Accuracy and Completeness | 6 | The ERD is readable and matches the implemented database. It includes tables, important attributes, primary keys, foreign keys, relationships, and correct cardinalities. |
| Backend CRUD and Data Operations | 6 | Create, Read, Update, and Delete operations work correctly through the backend/API and persist in Supabase PostgreSQL. Related records, constraints, and useful queries operate correctly. |